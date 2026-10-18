import type { Prisma } from "@prisma/client";
import { profileVerificationEnforced } from "@/lib/profile-gate";
import { canPublishListing } from "@/lib/listing-visibility";
import { lockAccountForContentLifecycle } from "@/lib/account-lifecycle";
import type { ListingModerationDecision } from "@/lib/listing-moderation";

export type ModeratedEntityType = "SHOP" | "SERVICE" | "PROPERTY";

export type EntityModerationResult =
  | { kind: "not-found" }
  | { kind: "seller-ineligible" }
  | { kind: "conflict" }
  | { kind: "updated"; sellerId: string; title: string; status: "ACTIVE" | "REJECTED" };

type ModerationTx = Pick<Prisma.TransactionClient, "$queryRaw" | "shop" | "serviceListing" | "propertyListing">;

/**
 * Apply a Shop, Service, or Property moderation decision under the same seller-row
 * lock as account holds. Each branch retains its own owner relation and title fields.
 */
export async function moderatePendingEntity(
  tx: ModerationTx,
  type: ModeratedEntityType,
  targetId: string,
  decision: ListingModerationDecision,
  requiresVerifiedProfile = profileVerificationEnforced(),
): Promise<EntityModerationResult> {
  const nextStatus = decision === "APPROVE" ? "ACTIVE" : "REJECTED";

  if (type === "SHOP") {
    const initial = await tx.shop.findFirst({ where: { id: targetId, status: "PENDING_REVIEW" }, select: { ownerId: true } });
    if (!initial) return { kind: "not-found" };
    await lockAccountForContentLifecycle(tx, initial.ownerId);
    const record = await tx.shop.findFirst({
      where: { id: targetId, ownerId: initial.ownerId, status: "PENDING_REVIEW" },
      select: { ownerId: true, name: true, owner: { select: { status: true, flaggedForReview: true, profileVerification: true } } },
    });
    if (!record) return { kind: "conflict" };
    if (decision === "APPROVE" && !canPublishListing(record.owner, requiresVerifiedProfile)) return { kind: "seller-ineligible" };
    const where: Prisma.ShopWhereInput = {
      id: targetId,
      ownerId: record.ownerId,
      status: "PENDING_REVIEW",
      ...(decision === "APPROVE" ? { owner: { is: { status: "ACTIVE", flaggedForReview: false, ...(requiresVerifiedProfile ? { profileVerification: "VERIFIED" } : {}) } } } : {}),
    };
    const updated = await tx.shop.updateMany({ where, data: { status: nextStatus } });
    if (updated.count !== 1) return { kind: "conflict" };
    return { kind: "updated", sellerId: record.ownerId, title: record.name, status: nextStatus };
  }

  if (type === "SERVICE") {
    const initial = await tx.serviceListing.findFirst({ where: { id: targetId, status: "PENDING_REVIEW" }, select: { providerId: true } });
    if (!initial) return { kind: "not-found" };
    await lockAccountForContentLifecycle(tx, initial.providerId);
    const record = await tx.serviceListing.findFirst({
      where: { id: targetId, providerId: initial.providerId, status: "PENDING_REVIEW" },
      select: { providerId: true, title: true, provider: { select: { status: true, flaggedForReview: true, profileVerification: true } } },
    });
    if (!record) return { kind: "conflict" };
    if (decision === "APPROVE" && !canPublishListing(record.provider, requiresVerifiedProfile)) return { kind: "seller-ineligible" };
    const where: Prisma.ServiceListingWhereInput = {
      id: targetId,
      providerId: record.providerId,
      status: "PENDING_REVIEW",
      ...(decision === "APPROVE" ? { provider: { is: { status: "ACTIVE", flaggedForReview: false, ...(requiresVerifiedProfile ? { profileVerification: "VERIFIED" } : {}) } } } : {}),
    };
    const updated = await tx.serviceListing.updateMany({ where, data: { status: nextStatus } });
    if (updated.count !== 1) return { kind: "conflict" };
    return { kind: "updated", sellerId: record.providerId, title: record.title, status: nextStatus };
  }

  const initial = await tx.propertyListing.findFirst({ where: { id: targetId, status: "PENDING_REVIEW" }, select: { ownerId: true } });
  if (!initial) return { kind: "not-found" };
  await lockAccountForContentLifecycle(tx, initial.ownerId);
  const record = await tx.propertyListing.findFirst({
    where: { id: targetId, ownerId: initial.ownerId, status: "PENDING_REVIEW" },
    select: { ownerId: true, title: true, owner: { select: { status: true, flaggedForReview: true, profileVerification: true } } },
  });
  if (!record) return { kind: "conflict" };
  if (decision === "APPROVE" && !canPublishListing(record.owner, requiresVerifiedProfile)) return { kind: "seller-ineligible" };
  const where: Prisma.PropertyListingWhereInput = {
    id: targetId,
    ownerId: record.ownerId,
    status: "PENDING_REVIEW",
    ...(decision === "APPROVE" ? { owner: { is: { status: "ACTIVE", flaggedForReview: false, ...(requiresVerifiedProfile ? { profileVerification: "VERIFIED" } : {}) } } } : {}),
  };
  const updated = await tx.propertyListing.updateMany({ where, data: { status: nextStatus } });
  if (updated.count !== 1) return { kind: "conflict" };
  return { kind: "updated", sellerId: record.ownerId, title: record.title, status: nextStatus };
}
