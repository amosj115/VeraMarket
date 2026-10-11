import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/security/password";
import { deleteAccountSchema } from "@/lib/validation/account";
import { anonymizeAccount, countActiveAdmins, deleteSolelyOwnedData, restrictOwnedContent } from "@/lib/account-lifecycle";

// Per-user account deletion. The acting identity is ALWAYS taken from the verified
// server-side session; a user id from the client is never trusted. Deletion is an
// anonymising tombstone (see `anonymizeAccount`) rather than a row delete, because the
// User model's 33 cascade relations would otherwise destroy other parties' conversations,
// offers, reports and moderation history.
export async function DELETE(request: NextRequest) {
  const session = await auth();
  console.log("DELETE /api/account session:", JSON.stringify(session));
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

  const parsed = deleteAccountSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, status: true, passwordHash: true } });
  if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  if (user.status === "DEACTIVATED") return NextResponse.json({ error: "This account is already deleted." }, { status: 400 });

  // Reuse the existing bcrypt primitive to re-verify the user's own password before a
  // permanent, irreversible action. No new authentication method is introduced.
  const validPassword = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!validPassword) return NextResponse.json({ error: "Incorrect password." }, { status: 403 });

  // Never let the last active administrator delete themselves and lock everyone out.
  if (user.role === "ADMIN" && (await countActiveAdmins()) <= 1) {
    return NextResponse.json({ error: "You are the last administrator. Promote another administrator before deleting this account." }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Hide all publicly visible content so no live listings or storefronts remain.
      await restrictOwnedContent(tx, userId);
      // Remove rows that belong solely to this account and carry personal data.
      await deleteSolelyOwnedData(tx, userId);
      // Scrub PII and mark the account DEACTIVATED. The row (and every foreign key that
      // points at it) is preserved so moderation, security and legal records stay intact.
      await anonymizeAccount(tx, userId);
      await tx.auditLog.create({
        data: { actorId: userId, action: "ACCOUNT_SELF_DELETED", targetType: "USER", targetId: userId, metadata: { method: "self" } },
      });
    });
  } catch {
    return NextResponse.json({ error: "Could not delete the account. Nothing was changed." }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
