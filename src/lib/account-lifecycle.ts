import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// A transaction handle that is either the global client or a client inside an
// interactive transaction. Every helper here takes one so it can be composed into a
// single atomic unit by the caller.
export type Tx = Prisma.TransactionClient;

/**
 * The account is only ever anonymised in place, never row-deleted. The User model has
 * 33 `onDelete: Cascade` relations, so a hard delete would destroy other parties'
 * conversations, offers, reports and moderation history. Scrubbing PII and marking the
 * row DEACTIVATED keeps every foreign key valid while removing the person.
 *
 * Callers are responsible for wrapping this in a transaction and writing an AuditLog
 * entry (see the audit helpers in the admin routes).
 */
export async function anonymizeAccount(tx: Tx, userId: string) {
  // Unique columns must stay unique across every tombstone, so they are derived from the
  // immutable user id rather than a shared constant.
  const tombstoneEmail = `deleted-${userId}@deleted.invalid`;
  const tombstoneUsername = `deleted_${userId.slice(0, 16)}`;

  await tx.user.update({
    where: { id: userId },
    data: {
      email: tombstoneEmail,
      username: tombstoneUsername,
      displayName: "Deleted account",
      phone: null,
      phoneVerifiedAt: null,
      phoneVerification: "NOT_VERIFIED",
      avatarUrl: null,
      bio: null,
      location: null,
      // An unusable hash so the tombstone can never be logged into.
      passwordHash: "deleted",
      emailVerifiedAt: null,
      identityVerification: "NOT_VERIFIED",
      profileVerification: "NOT_VERIFIED",
      profileVerifiedAt: null,
      profilePhotoConsentAt: null,
      trendingNotificationsEnabled: false,
      status: "DEACTIVATED",
      deactivatedAt: new Date(),
    },
  });
}

/**
 * Removes rows that belong solely to this account and carry personal data with no other
 * party attached. It deliberately does NOT touch conversations, messages, offers,
 * reports, reviews, payments, boosts or audit logs — those are needed by the other party
 * or by moderation/legal processes, and their foreign keys now point at an anonymised
 * tombstone rather than a dangling id.
 */
export async function deleteSolelyOwnedData(tx: Tx, userId: string) {
  await Promise.all([
    tx.favorite.deleteMany({ where: { userId } }),
    tx.listingLike.deleteMany({ where: { userId } }),
    tx.listingEngagement.deleteMany({ where: { userId } }),
    tx.searchActivity.deleteMany({ where: { userId } }),
    tx.savedSearch.deleteMany({ where: { userId } }),
    tx.notification.deleteMany({ where: { userId } }),
    tx.otpCode.deleteMany({ where: { userId } }),
    tx.verificationRequest.deleteMany({ where: { userId } }),
    tx.faceVerificationAttempt.deleteMany({ where: { userId } }),
    tx.identityVerification.deleteMany({ where: { userId } }),
    tx.sellerFollow.deleteMany({ where: { OR: [{ followerId: userId }, { sellerId: userId }] } }),
    tx.shopFollower.deleteMany({ where: { userId } }),
    tx.userAchievement.deleteMany({ where: { userId } }),
    tx.session.deleteMany({ where: { userId } }),
  ]);
}

/**
 * Hides every publicly visible piece of content owned by the account so a deleted or held
 * seller leaves no live listings, broken profiles or orphaned storefronts. Content is set
 * to REMOVED (hidden, data preserved) rather than deleted, so it can be restored if a
 * hold is lifted and so other parties' offers/messages about it stay intact.
 *
 * Only rows that are currently ACTIVE are touched; independently moderated rows
 * (REJECTED, PENDING_REVIEW, SOLD, already REMOVED) are left exactly as they are. The
 * returned ids are stored on the hold so a lift restores precisely this set.
 */
export async function restrictOwnedContent(tx: Tx, userId: string) {
  // Read the currently-ACTIVE ids first so we know exactly which rows this hold is about
  // to hide. Only those are stored on the hold for a later restore; anything already
  // REJECTED, PENDING_REVIEW, SOLD or REMOVED is never captured here.
  const [listingRows, shopRows, serviceRows, propertyRows] = await Promise.all([
    tx.listing.findMany({ where: { sellerId: userId, status: "ACTIVE" }, select: { id: true } }),
    tx.shop.findMany({ where: { ownerId: userId, status: "ACTIVE" }, select: { id: true } }),
    tx.serviceListing.findMany({ where: { providerId: userId, status: "ACTIVE" }, select: { id: true } }),
    tx.propertyListing.findMany({ where: { ownerId: userId, status: "ACTIVE" }, select: { id: true } }),
  ]);

  const listingIds = listingRows.map((r) => r.id);
  const shopIds = shopRows.map((r) => r.id);
  const serviceIds = serviceRows.map((r) => r.id);
  const propertyIds = propertyRows.map((r) => r.id);

  await Promise.all([
    listingIds.length ? tx.listing.updateMany({ where: { id: { in: listingIds } }, data: { status: "REMOVED" } }) : Promise.resolve(null),
    shopIds.length ? tx.shop.updateMany({ where: { id: { in: shopIds } }, data: { status: "REMOVED" } }) : Promise.resolve(null),
    serviceIds.length ? tx.serviceListing.updateMany({ where: { id: { in: serviceIds } }, data: { status: "REMOVED" } }) : Promise.resolve(null),
    propertyIds.length ? tx.propertyListing.updateMany({ where: { id: { in: propertyIds } }, data: { status: "REMOVED" } }) : Promise.resolve(null),
  ]);

  return { listingIds, shopIds, serviceIds, propertyIds };
}

function idsFromJson(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/**
 * Restores exactly the content that a given hold hid, and nothing else. A row is only
 * restored if it is still REMOVED — anything a moderator independently REJECTED or
 * otherwise changed during the hold is skipped, so lifting a hold never overrides an
 * unrelated moderation decision.
 */
export async function restoreHeldContent(
  tx: Tx,
  hold: { userId: string; heldListingIds: unknown; heldShopIds: unknown; heldServiceIds: unknown; heldPropertyIds: unknown },
) {
  const [listings, shops, services, properties] = await Promise.all([
    tx.listing.findMany({ where: { id: { in: idsFromJson(hold.heldListingIds) }, sellerId: hold.userId }, select: { id: true, status: true } }),
    tx.shop.findMany({ where: { id: { in: idsFromJson(hold.heldShopIds) }, ownerId: hold.userId }, select: { id: true, status: true } }),
    tx.serviceListing.findMany({ where: { id: { in: idsFromJson(hold.heldServiceIds) }, providerId: hold.userId }, select: { id: true, status: true } }),
    tx.propertyListing.findMany({ where: { id: { in: idsFromJson(hold.heldPropertyIds) }, ownerId: hold.userId }, select: { id: true, status: true } }),
  ]);

  // Only rows still REMOVED are restored. Anything a moderator independently REJECTED or
  // otherwise changed during the hold is skipped, so a lift never overrides an unrelated
  // moderation decision.
  const stillRemoved = (rows: { id: string; status: string }[]) => rows.filter((r) => r.status === "REMOVED").map((r) => r.id);

  const [listingIds, shopIds, serviceIds, propertyIds] = [
    stillRemoved(listings),
    stillRemoved(shops),
    stillRemoved(services),
    stillRemoved(properties),
  ];

  await Promise.all([
    listingIds.length ? tx.listing.updateMany({ where: { id: { in: listingIds } }, data: { status: "ACTIVE" } }) : Promise.resolve(null),
    shopIds.length ? tx.shop.updateMany({ where: { id: { in: shopIds } }, data: { status: "ACTIVE" } }) : Promise.resolve(null),
    serviceIds.length ? tx.serviceListing.updateMany({ where: { id: { in: serviceIds } }, data: { status: "ACTIVE" } }) : Promise.resolve(null),
    propertyIds.length ? tx.propertyListing.updateMany({ where: { id: { in: propertyIds } }, data: { status: "ACTIVE" } }) : Promise.resolve(null),
  ]);
}

/** Count of ADMIN accounts that are not deactivated, used to protect the last admin. */
export async function countActiveAdmins(tx: Tx = prisma): Promise<number> {
  return tx.user.count({ where: { role: "ADMIN", status: { not: "DEACTIVATED" } } });
}
