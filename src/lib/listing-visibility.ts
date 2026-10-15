import type { Prisma, User } from "@prisma/client";
import { profileVerificationEnforced } from "@/lib/profile-gate";

export type ListingSellerEligibility = Pick<User, "status" | "flaggedForReview" | "profileVerification">;

/**
 * Review flags and the configured profile-verification gate stop new listings from
 * being published, but do not hide content that was already approved. Public visibility
 * therefore depends on listing and account status; approval checks all publication gates.
 */
export function canPublishListing(
  seller: ListingSellerEligibility | null | undefined,
  requiresVerifiedProfile = profileVerificationEnforced(),
): boolean {
  return seller?.status === "ACTIVE" && !seller.flaggedForReview && (!requiresVerifiedProfile || seller.profileVerification === "VERIFIED");
}

export function publicListingWhere(): Prisma.ListingWhereInput {
  return {
    status: "ACTIVE",
    seller: { is: { status: "ACTIVE" } },
  };
}
