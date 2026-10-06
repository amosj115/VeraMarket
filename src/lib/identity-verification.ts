import type { IdentityVerificationState } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Applies a provider-confirmed state to the verification record and the user's profile in one transaction.
 * `eventAt` orders events (providers don't guarantee delivery order); older events are ignored.
 * Only APPROVED can ever set the profile to VERIFIED, and only server-side (webhook) code calls this with APPROVED.
 */
export async function applyIdentityState(externalId: string, state: IdentityVerificationState, eventAt: Date, opts: { expectUserId?: string } = {}) {
  const record = await prisma.identityVerification.findUnique({ where: { externalId } });
  if (!record) return { applied: false as const, reason: "unknown_inquiry" };
  if (opts.expectUserId && opts.expectUserId !== record.userId) return { applied: false as const, reason: "user_mismatch" };
  if (record.lastEventAt && eventAt < record.lastEventAt) return { applied: false as const, reason: "stale_event" };

  const failureCode = state === "DECLINED" || state === "FAILED" || state === "EXPIRED" || state === "CANCELLED" ? state : null;
  const user = await prisma.user.findUnique({ where: { id: record.userId }, select: { profileVerification: true } });
  let profile: { profileVerification: "NOT_VERIFIED" | "PENDING" | "VERIFIED" | "FAILED"; profileVerifiedAt?: Date | null } | null = null;
  if (state === "APPROVED") profile = { profileVerification: "VERIFIED", profileVerifiedAt: new Date() };
  else if (user?.profileVerification !== "VERIFIED" || record.state === "APPROVED") {
    if (state === "PENDING" || state === "CREATED") profile = { profileVerification: "PENDING" };
    else if (state === "DECLINED" || state === "FAILED") profile = { profileVerification: "FAILED", profileVerifiedAt: null };
    else profile = { profileVerification: "NOT_VERIFIED", profileVerifiedAt: null };
  }

  await prisma.$transaction([
    prisma.identityVerification.update({ where: { id: record.id }, data: { state, failureCode, lastEventAt: eventAt } }),
    ...(profile ? [prisma.user.update({ where: { id: record.userId }, data: profile })] : []),
    prisma.auditLog.create({ data: { actorId: record.userId, action: `IDENTITY_VERIFICATION_${state}`, targetType: "USER", targetId: record.userId, metadata: { provider: record.provider, externalId } } }),
  ]);
  if (state === "APPROVED") await (await import("@/lib/achievements")).evaluateAchievements(record.userId).catch(() => null);
  return { applied: true as const, userId: record.userId };
}
