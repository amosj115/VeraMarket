import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { adminDeleteAccountSchema, adminHoldSchema, adminLiftHoldSchema, adminReviewFlagSchema } from "@/lib/validation/account";
import { accountHoldStatusError, anonymizeAccount, deleteSolelyOwnedData, liftAccountHold, lockAccountForAdminLifecycle, placeAccountHold, restrictOwnedContent } from "@/lib/account-lifecycle";
import { hashEmailLegacy } from "@/lib/account-security";
import { escapeHtml } from "@/lib/email";

interface AdminSession {
  user: {
    id: string;
    role: string;
  };
}

// Admin management endpoints. Only ADMIN role is allowed.
async function adminOnly(): Promise<AdminSession | null> {
  const session = await auth();
  return session?.user && session.user.role === "ADMIN" ? { user: { id: session.user.id, role: session.user.role } } : null;
}

// Search accounts and expose their current hold state to admins.
export async function GET(request: NextRequest) {
  const session = await adminOnly();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  // Deleted (DEACTIVATED) tombstones are intentionally excluded, matching the
  // /admin/accounts page: every action on this endpoint rejects them anyway, and their
  // history stays fully queryable in AuditLog and DeletedAccountRecord.
  const users = await prisma.user.findMany({
    where: {
      status: { not: "DEACTIVATED" },
      OR: query
        ? [{ username: { contains: query, mode: "insensitive" } }, { email: { contains: query, mode: "insensitive" } }, { displayName: { contains: query, mode: "insensitive" } }]
        : undefined,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      username: true,
      displayName: true,
      email: true,
      role: true,
      status: true,
      flaggedForReview: true,
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

  try {
    const result = await prisma.$transaction(async (tx) => {
      return placeAccountHold(tx, userId, actorId, reason);
    }, { isolationLevel: "ReadCommitted" });
    if (result.kind === "not-found") return NextResponse.json({ error: "Account not found." }, { status: 404 });
    if (result.kind === "already-held") return NextResponse.json({ error: "This account already has an active hold." }, { status: 400 });
    if (result.kind === "last-active-admin") return NextResponse.json({ error: "This is the last active administrator; it cannot be held." }, { status: 400 });
    if (result.kind === "ineligible") return NextResponse.json({ error: accountHoldStatusError(result.status) }, { status: result.status === "DEACTIVATED" ? 400 : 409 });
  } catch {
    return NextResponse.json({ error: "Could not place the hold. Nothing was changed." }, { status: 500 });
  }

  return NextResponse.json({ held: true });
}

// Lift a hold. Restore its content only when no other hold remains and the account is
// still in a status that can legitimately resume. A ban or deletion keeps the content hidden.
export async function PATCH(request: NextRequest) {
  const session = await adminOnly();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  // Handle review flag set/clear. Flagging marks an account as under investigation; it
  // restricts publishing (see src/lib/review-enforcement.ts) but is not a finding of
  // wrongdoing, and it never hides or deletes existing content.
  if (body.action === "flagReview" || body.action === "clearReview") {
    const parsed = adminReviewFlagSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    const { userId } = parsed.data;
    const flag = body.action === "flagReview";

    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, status: true, flaggedForReview: true } });
    if (!target) return NextResponse.json({ error: "Account not found." }, { status: 404 });
    if (target.status === "DEACTIVATED") return NextResponse.json({ error: "This account is already deleted." }, { status: 400 });
    if (target.flaggedForReview === flag) {
      return NextResponse.json({ error: flag ? "This account is already flagged for review." : "This account is not flagged for review." }, { status: 400 });
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { flaggedForReview: flag } });
        await tx.auditLog.create({
          data: {
            actorId: session.user.id,
            action: flag ? "ACCOUNT_FLAGGED_FOR_REVIEW" : "ACCOUNT_REVIEW_CLEARED",
            targetType: "USER",
            targetId: userId,
          },
        });
      });
      return NextResponse.json({ flagged: flag, cleared: !flag });
    } catch {
      return NextResponse.json({ error: flag ? "Could not flag the account for review." : "Could not clear review flag." }, { status: 500 });
    }
  }

  const parsed = adminLiftHoldSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  const { userId } = parsed.data;
  const actorId = session.user.id;

  const hold = await prisma.accountHold.findFirst({ where: { userId, active: true }, orderBy: [{ placedAt: "desc" }, { id: "desc" }] });
  if (!hold) return NextResponse.json({ error: "No active hold on this account." }, { status: 404 });

  try {
    const result = await prisma.$transaction(
      (tx) => liftAccountHold(tx, userId, hold.id, actorId),
      { isolationLevel: "ReadCommitted" },
    );
    if (result === "changed") return NextResponse.json({ error: "This account hold has already been lifted." }, { status: 409 });
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
  const { userId, reason, customReason } = parsed.data;
  const actorId = session.user.id;

  // Custom reason requirement for "Other"
  if (reason === "Other" && (!customReason || customReason.trim().length === 0)) {
    return NextResponse.json({ error: "Please provide a custom reason when 'Other' is selected." }, { status: 400 });
  }

  // Prevent accidental self-deletion through the admin path.
  if (userId === actorId) return NextResponse.json({ error: "You cannot delete your own account from the admin panel." }, { status: 400 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const guarded = await lockAccountForAdminLifecycle(tx, userId);
      if (guarded.kind !== "ready") return guarded.kind;
      const target = guarded.target;
      if (target.status === "DEACTIVATED") return "already-deactivated" as const;

      // Close any open holds so no dangling active hold outlives the account.
      await tx.accountHold.updateMany({ where: { userId, active: true }, data: { active: false, liftedAt: new Date() } });
      await restrictOwnedContent(tx, userId);
      await deleteSolelyOwnedData(tx, userId);
      await anonymizeAccount(tx, userId);

      // Record deletion with reason and email hash for repeat-offender detection.
      await tx.deletedAccountRecord.create({
        data: {
          emailHash: hashEmailLegacy(target.email),
          reason,
          customReason,
          deletedByUserId: actorId,
        },
      });

      // Queue the notification. The HTML body escapes the admin-supplied reasons; the
      // plain-text body needs no escaping.
      const reasonLabel = customReason ? `${reason} (${customReason})` : reason;
      await tx.notificationJob.create({
        data: {
          recipientEmail: target.email,
          subject: "Account Deactivation Notice",
          text: `Your Vera Market account has been deactivated. Reason: ${reasonLabel}. You may register a new account, but it may be subject to additional review. Contact support if you believe this is an error.`,
          html: `<p>Your Vera Market account has been deactivated.</p><p><strong>Reason:</strong> ${escapeHtml(reasonLabel)}</p><p>You may register a new account, but it may be subject to additional verification or review.</p><p>If you believe this is an error, please contact our support team.</p>`,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "ACCOUNT_DELETED_BY_ADMIN",
          targetType: "USER",
          targetId: userId,
          metadata: { reason, customReason }
        }
      });
      return "deleted" as const;
    }, { isolationLevel: "ReadCommitted" });

    if (result === "not-found") return NextResponse.json({ error: "Account not found." }, { status: 404 });
    if (result === "already-deactivated") return NextResponse.json({ error: "This account is already deleted." }, { status: 400 });
    if (result === "last-active-admin") return NextResponse.json({ error: "This is the last active administrator; it cannot be deleted." }, { status: 400 });

  } catch (err) {
    console.error("[admin-accounts] Deletion failed", err);
    return NextResponse.json({ error: "Could not delete the account. Nothing was changed." }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
