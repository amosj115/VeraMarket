import type { Prisma } from "@prisma/client";
import { profileVerificationEnforced } from "@/lib/profile-gate";
import { canPublishListing } from "@/lib/listing-visibility";
import { lockAccountForContentLifecycle } from "@/lib/account-lifecycle";

export type ListingModerationDecision = "APPROVE" | "REJECT";

export type ListingModerationResult =
  | { kind: "not-found" }
  | { kind: "seller-ineligible" }
  | { kind: "conflict" }
  | { kind: "updated"; sellerId: string; title: string; status: "ACTIVE" | "REJECTED" };

/** Apply a listing decision only while it is pending and, on approval, its seller is eligible. */
export async function moderatePendingListing(
  tx: Pick<Prisma.TransactionClient, "listing" | "$queryRaw">,
  targetId: string,
  decision: ListingModerationDecision,
  requiresVerifiedProfile = profileVerificationEnforced(),
): Promise<ListingModerationResult> {
  const initial = await tx.listing.findFirst({
    where: { id: targetId, status: "PENDING_REVIEW" },
    select: { sellerId: true },
  });
  if (!initial) return { kind: "not-found" };

  // Account holds and content removal take this same seller-row lock before scanning
  // or changing owned listings. Re-read after acquiring it so a hold that won the lock
  // is observed before approval, while an approval that won first is included in the
  // hold's active-listing snapshot.
  await lockAccountForContentLifecycle(tx, initial.sellerId);

  const record = await tx.listing.findFirst({
    where: { id: targetId, sellerId: initial.sellerId, status: "PENDING_REVIEW" },
    select: {
      sellerId: true,
      title: true,
      seller: { select: { status: true, flaggedForReview: true, profileVerification: true } },
    },
  });
  if (!record) return { kind: "conflict" };
  if (decision === "APPROVE" && !canPublishListing(record.seller, requiresVerifiedProfile)) {
    return { kind: "seller-ineligible" };
  }

  const status = decision === "APPROVE" ? "ACTIVE" : "REJECTED";
  const where: Prisma.ListingWhereInput = {
    id: targetId,
    sellerId: record.sellerId,
    status: "PENDING_REVIEW",
    ...(decision === "APPROVE"
      ? {
          seller: {
            is: {
              status: "ACTIVE",
              flaggedForReview: false,
              ...(requiresVerifiedProfile ? { profileVerification: "VERIFIED" } : {}),
            },
          },
        }
      : {}),
  };
  const updated = await tx.listing.updateMany({ where, data: { status } });
  if (updated.count !== 1) return { kind: "conflict" };

  return { kind: "updated", sellerId: record.sellerId, title: record.title, status };
}
