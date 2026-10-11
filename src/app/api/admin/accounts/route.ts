import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { adminDeleteAccountSchema, adminHoldSchema, adminLiftHoldSchema } from "@/lib/validation/account";
import { anonymizeAccount, countActiveAdmins, deleteSolelyOwnedData, restrictOwnedContent, restoreHeldContent } from "@/lib/account-lifecycle";

// Account management is security-level, so it is ADMIN-only (matching /admin/config and
// /admin/trending). MODERATOR is deliberately NOT given these powers; the existing
// content-moderation split is preserved and not widened.
async function adminOnly() {
  const session = await auth();
  return session?.user && session.user.role === "ADMIN" ? session : null;
}

// Search accounts and expose their current hold state to admins.
export async function GET(request: NextRequest) {
  const session = await adminOnly();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const users = await prisma.user.findMany({
    where: query
      ? { OR: [{ username: { contains: query, mode: "insensitive" } }, { email: { contains: query, mode: "insensitive" } }, { displayName: { contains: query, mode: "insensitive" } }] }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      username: true,
      displayName: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      accountHolds: { where: { active: true }, select: { id: true, reason: true, placedAt: true, placedBy: { select: { username: true } } }, take: 1 },
      _count: { select: { listings: true, shops: true } },
    },
  });

  return NextResponse.json({
    users: users.map((user) => ({
      ...user,
      activeHold: user.accountHolds[0] ? { ...user.accountHolds[0], placedBy: user.accountHolds[0].placedBy.username } : null,
      accountHolds: undefined,
    })),
  });
}

// Place a hold. Records the acting admin and reason, hides the account's ACTIVE content
// (recording exactly which rows were hidden so a lift restores only those), and sets the
// account SUSPENDED so login and all existing JWT sessions are rejected.
export async function POST(request: NextRequest) {
  const session = await adminOnly();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = adminHoldSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  const { userId, reason } = parsed.data;
  const actorId = session.user.id;

  if (userId === actorId) return NextResponse.json({ error: "You cannot place a hold on your own account." }, { status: 400 });

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, status: true, role: true } });
  if (!target) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  if (target.status === "DEACTIVATED") return NextResponse.json({ error: "This account is already deleted." }, { status: 400 });
  if (await prisma.accountHold.count({ where: { userId, active: true } }) > 0) {
    return NextResponse.json({ error: "This account already has an active hold." }, { status: 400 });
  }
  // Never lock out the last remaining administrator.
  if (target.role === "ADMIN" && (await countActiveAdmins()) <= 1) {
    return NextResponse.json({ error: "This is the last active administrator; it cannot be held." }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const held = await restrictOwnedContent(tx, userId);
      await tx.accountHold.create({
        data: { userId, reason, placedById: actorId, heldListingIds: held.listingIds, heldShopIds: held.shopIds, heldServiceIds: held.serviceIds, heldPropertyIds: held.propertyIds },
      });
      await tx.user.update({ where: { id: userId }, data: { status: "SUSPENDED" } });
      await tx.auditLog.create({ data: { actorId, action: "ACCOUNT_HOLD_PLACED", targetType: "USER", targetId: userId, metadata: { reason } } });
    });
  } catch {
    return NextResponse.json({ error: "Could not place the hold. Nothing was changed." }, { status: 500 });
  }

  return NextResponse.json({ held: true });
}

// Lift a hold. Restores only the content this hold hid (skipping anything independently
// moderated in the meantime) and re-activates the account unless another hold is active.
export async function PATCH(request: NextRequest) {
  const session = await adminOnly();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = adminLiftHoldSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  const { userId } = parsed.data;
  const actorId = session.user.id;

  const hold = await prisma.accountHold.findFirst({ where: { userId, active: true }, orderBy: { placedAt: "desc" } });
  if (!hold) return NextResponse.json({ error: "No active hold on this account." }, { status: 404 });

  try {
    await prisma.$transaction(async (tx) => {
      await restoreHeldContent(tx, hold);
      await tx.accountHold.update({ where: { id: hold.id }, data: { active: false, liftedById: actorId, liftedAt: new Date() } });
      // Only re-activate if no other hold is still open on this account.
      const remaining = await tx.accountHold.count({ where: { userId, active: true, id: { not: hold.id } } });
      if (remaining === 0) {
        const target = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
        if (target?.status === "SUSPENDED") await tx.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
      }
      await tx.auditLog.create({ data: { actorId, action: "ACCOUNT_HOLD_LIFTED", targetType: "USER", targetId: userId } });
    });
  } catch {
    return NextResponse.json({ error: "Could not lift the hold. Nothing was changed." }, { status: 500 });
  }

  return NextResponse.json({ lifted: true });
}

// Administrative deletion. Same anonymising tombstone as self-service deletion, but the
// acting admin (not the target) is recorded as the audit actor, and a reason is required.
export async function DELETE(request: NextRequest) {
  const session = await adminOnly();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = adminDeleteAccountSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  const { userId, reason } = parsed.data;
  const actorId = session.user.id;

  // Prevent accidental self-deletion through the admin path.
  if (userId === actorId) return NextResponse.json({ error: "You cannot delete your own account from the admin panel." }, { status: 400 });

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, status: true } });
  if (!target) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  if (target.status === "DEACTIVATED") return NextResponse.json({ error: "This account is already deleted." }, { status: 400 });
  if (target.role === "ADMIN" && (await countActiveAdmins()) <= 1) {
    return NextResponse.json({ error: "This is the last active administrator; it cannot be deleted." }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Close any open holds so no dangling active hold outlives the account.
      await tx.accountHold.updateMany({ where: { userId, active: true }, data: { active: false, liftedAt: new Date() } });
      await restrictOwnedContent(tx, userId);
      await deleteSolelyOwnedData(tx, userId);
      await anonymizeAccount(tx, userId);
      await tx.auditLog.create({ data: { actorId, action: "ACCOUNT_DELETED_BY_ADMIN", targetType: "USER", targetId: userId, metadata: { reason } } });
    });
  } catch {
    return NextResponse.json({ error: "Could not delete the account. Nothing was changed." }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
