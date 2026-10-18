import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// A transaction handle that is either the global client or a client inside an
// interactive transaction. Every helper here takes one so it can be composed into a
// single atomic unit by the caller.
export type Tx = Prisma.TransactionClient;

type AccountLifecycleTarget = {
  id: string;
  role: string;
  status: string;
  email: string;
};

export function accountHoldStatusError(status: string): string | null {
  if (status === "ACTIVE") return null;
  if (status === "DEACTIVATED") return "This account is already deleted.";
  if (status === "BANNED") return "This account is banned and cannot be held.";
  return "This account is already suspended.";
}

export function shouldRestoreAfterHoldLift(status: string, remainingActiveHolds: number): boolean {
  return remainingActiveHolds === 0 && (status === "ACTIVE" || status === "SUSPENDED");
}

/**
 * Serialize account status and owned-content lifecycle operations on the seller row.
 * Listing approval and seller status changes must take this same lock in their
 * transaction, so a hold cannot miss a listing that becomes ACTIVE during its scan.
 */
export async function lockAccountForContentLifecycle(tx: Pick<Tx, "$queryRaw">, userId: string) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
}

/**
 * Serialize any operation that can remove an active administrator. The transaction
 * advisory lock is global to the admin roster, so two requests targeting different
 * admins still re-check the count one at a time.
 */
export async function lockAdminRosterForLifecycle(tx: Pick<Tx, "$queryRaw">) {
  // This two-int key is reserved for Vera Market's admin-roster lifecycle lock.
  // Keep the void-returning lock call in a volatile subquery, while returning an int
  // column that Prisma's PostgreSQL raw-query mapper can decode.
  await tx.$queryRaw`SELECT 1 AS acquired FROM (SELECT pg_advisory_xact_lock(864219, 4107)) AS admin_roster_lock`;
}

export type AdminLifecycleTargetResult =
  | { kind: "not-found" }
  | { kind: "last-active-admin"; target: AccountLifecycleTarget }
  | { kind: "ready"; target: AccountLifecycleTarget };

/** Lock the roster first, then the target row, and re-read its current eligibility. */
export async function lockAccountForAdminLifecycle(tx: Tx, userId: string): Promise<AdminLifecycleTargetResult> {
  await lockAdminRosterForLifecycle(tx);
  await lockAccountForContentLifecycle(tx, userId);
  const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, status: true, email: true } });
  if (!target) return { kind: "not-found" };
  if (target.role === "ADMIN" && target.status === "ACTIVE" && await countActiveAdmins(tx) <= 1) {
    return { kind: "last-active-admin", target };
  }
  return { kind: "ready", target };
}

export type PrepareAccountHoldResult =
  | { kind: "not-found" }
  | { kind: "last-active-admin" }
  | { kind: "ineligible"; status: string }
  | { kind: "already-held" }
  | { kind: "ready"; target: AccountLifecycleTarget };

/** Validate a hold target only after acquiring both lifecycle locks and re-reading state. */
export async function prepareAccountHold(tx: Tx, userId: string): Promise<PrepareAccountHoldResult> {
  const guarded = await lockAccountForAdminLifecycle(tx, userId);
  if (guarded.kind !== "ready") return guarded;
  const statusError = accountHoldStatusError(guarded.target.status);
  if (statusError) return { kind: "ineligible", status: guarded.target.status };
  if (await tx.accountHold.count({ where: { userId, active: true } }) > 0) return { kind: "already-held" };
  return guarded;
}

export type PlaceAccountHoldResult = Exclude<PrepareAccountHoldResult, { kind: "ready" }> | { kind: "held" };

/** Place a hold atomically after the shared account/admin locks have been acquired. */
export async function placeAccountHold(tx: Tx, userId: string, actorId: string, reason: string): Promise<PlaceAccountHoldResult> {
  const prepared = await prepareAccountHold(tx, userId);
  if (prepared.kind !== "ready") return prepared;

  const held = await restrictOwnedContent(tx, userId);
  const hold = await tx.accountHold.create({
    data: { userId, reason, placedById: actorId, heldListingIds: held.listingIds, heldShopIds: held.shopIds, heldServiceIds: held.serviceIds, heldPropertyIds: held.propertyIds },
  });
  await recordHoldContentProvenance(tx, hold.id, actorId, held);
  await tx.user.update({ where: { id: userId }, data: { status: "SUSPENDED" } });
  await tx.auditLog.create({ data: { actorId, action: "ACCOUNT_HOLD_PLACED", targetType: "USER", targetId: userId, metadata: { reason } } });
  return { kind: "held" };
}

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
  await lockAccountForContentLifecycle(tx, userId);
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
  await lockAccountForContentLifecycle(tx, userId);
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
    listingIds.length ? tx.listing.updateMany({ where: { id: { in: listingIds }, sellerId: userId, status: "ACTIVE" }, data: { status: "REMOVED" } }) : Promise.resolve(null),
    shopIds.length ? tx.shop.updateMany({ where: { id: { in: shopIds }, ownerId: userId, status: "ACTIVE" }, data: { status: "REMOVED" } }) : Promise.resolve(null),
    serviceIds.length ? tx.serviceListing.updateMany({ where: { id: { in: serviceIds }, providerId: userId, status: "ACTIVE" }, data: { status: "REMOVED" } }) : Promise.resolve(null),
    propertyIds.length ? tx.propertyListing.updateMany({ where: { id: { in: propertyIds }, ownerId: userId, status: "ACTIVE" }, data: { status: "REMOVED" } }) : Promise.resolve(null),
  ]);

  return { listingIds, shopIds, serviceIds, propertyIds };
}

function idsFromJson(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

type HeldContentKind = "LISTING" | "SHOP" | "SERVICE" | "PROPERTY";
type HoldContentAuditAction = "ACCOUNT_HOLD_CONTENT_HELD" | "ACCOUNT_HOLD_CONTENT_REMOVED";

const heldIdsField = {
  LISTING: "heldListingIds",
  SHOP: "heldShopIds",
  SERVICE: "heldServiceIds",
  PROPERTY: "heldPropertyIds",
} as const;

type HeldContentSnapshot = {
  id: string;
  userId: string;
  heldListingIds: unknown;
  heldShopIds: unknown;
  heldServiceIds: unknown;
  heldPropertyIds: unknown;
};

function mergeIds(first: unknown, second: unknown): string[] {
  return [...new Set([...idsFromJson(first), ...idsFromJson(second)])];
}

function holdContentDescriptor(metadata: unknown): { contentType: HeldContentKind; contentId: string } | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = metadata as Record<string, unknown>;
  if ((value.contentType === "LISTING" || value.contentType === "SHOP" || value.contentType === "SERVICE" || value.contentType === "PROPERTY") && typeof value.contentId === "string") {
    return { contentType: value.contentType, contentId: value.contentId };
  }
  return null;
}

async function recordHoldContentProvenance(
  tx: Tx,
  holdId: string,
  actorId: string,
  held: Awaited<ReturnType<typeof restrictOwnedContent>>,
) {
  const entries: Array<{ contentType: HeldContentKind; contentId: string }> = [
    ...held.listingIds.map((contentId) => ({ contentType: "LISTING" as const, contentId })),
    ...held.shopIds.map((contentId) => ({ contentType: "SHOP" as const, contentId })),
    ...held.serviceIds.map((contentId) => ({ contentType: "SERVICE" as const, contentId })),
    ...held.propertyIds.map((contentId) => ({ contentType: "PROPERTY" as const, contentId })),
  ];
  if (entries.length > 0) {
    await tx.auditLog.createMany({
      data: entries.map(({ contentType, contentId }) => ({
      actorId,
      action: "ACCOUNT_HOLD_CONTENT_HELD",
      targetType: "ACCOUNT_HOLD",
      targetId: holdId,
      metadata: { contentType, contentId },
      })),
    });
  }
}

/** Carry a lifted hold's snapshot and provenance/exclusions into the oldest remaining hold. */
async function mergeHeldContentSnapshot(tx: Tx, source: HeldContentSnapshot, destination: HeldContentSnapshot) {
  await tx.accountHold.update({
    where: { id: destination.id },
    data: {
      heldListingIds: mergeIds(destination.heldListingIds, source.heldListingIds),
      heldShopIds: mergeIds(destination.heldShopIds, source.heldShopIds),
      heldServiceIds: mergeIds(destination.heldServiceIds, source.heldServiceIds),
      heldPropertyIds: mergeIds(destination.heldPropertyIds, source.heldPropertyIds),
    },
  });

  const actions: HoldContentAuditAction[] = ["ACCOUNT_HOLD_CONTENT_HELD", "ACCOUNT_HOLD_CONTENT_REMOVED"];
  for (const action of actions) {
    const [existingMarkers, sourceMarkers] = await Promise.all([
      tx.auditLog.findMany({
        where: { action, targetType: "ACCOUNT_HOLD", targetId: destination.id },
        select: { metadata: true },
      }),
      tx.auditLog.findMany({
        where: { action, targetType: "ACCOUNT_HOLD", targetId: source.id },
        select: { actorId: true, metadata: true },
      }),
    ]);
    const seen = new Set(existingMarkers.map((marker) => {
      const descriptor = holdContentDescriptor(marker.metadata);
      return descriptor ? `${descriptor.contentType}\u0000${descriptor.contentId}` : "";
    }));
    const transfer: Array<{ actorId: string; action: HoldContentAuditAction; targetType: "ACCOUNT_HOLD"; targetId: string; metadata: { contentType: HeldContentKind; contentId: string; transferredFromHoldId: string } }> = [];
    for (const marker of sourceMarkers) {
      const descriptor = holdContentDescriptor(marker.metadata);
      if (!descriptor) continue;
      const key = `${descriptor.contentType}\u0000${descriptor.contentId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      transfer.push({
        actorId: marker.actorId,
        action,
        targetType: "ACCOUNT_HOLD",
        targetId: destination.id,
        metadata: { ...descriptor, transferredFromHoldId: source.id },
      });
    }
    if (transfer.length > 0) await tx.auditLog.createMany({ data: transfer });
  }
}

export type LiftAccountHoldResult = "changed" | "lifted";

/**
 * Lift one hold under the same lock order used for placing holds and deleting accounts.
 * When older overlapping holds remain, carry this snapshot into the oldest survivor so
 * the last lift can restore the complete set that the hold episode originally hid.
 */
export async function liftAccountHold(tx: Tx, userId: string, holdId: string, actorId: string): Promise<LiftAccountHoldResult> {
  await lockAdminRosterForLifecycle(tx);
  await lockAccountForContentLifecycle(tx, userId);
  const currentHold = await tx.accountHold.findFirst({ where: { id: holdId, userId, active: true } });
  if (!currentHold) return "changed";
  const target = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!target) return "changed";

  const deactivatedHold = await tx.accountHold.updateMany({
    where: { id: holdId, userId, active: true },
    data: { active: false, liftedById: actorId, liftedAt: new Date() },
  });
  if (deactivatedHold.count !== 1) throw new Error("Account hold changed while it was being lifted.");

  const remainingHolds = await tx.accountHold.findMany({
    where: { userId, active: true },
    orderBy: [{ placedAt: "asc" }, { id: "asc" }],
  });
  if (remainingHolds.length > 0) {
    await mergeHeldContentSnapshot(tx, currentHold, remainingHolds[0]);
  } else if (shouldRestoreAfterHoldLift(target.status, 0)) {
    await restoreHeldContent(tx, currentHold);
    if (target.status === "SUSPENDED") {
      const reactivated = await tx.user.updateMany({ where: { id: userId, status: "SUSPENDED" }, data: { status: "ACTIVE" } });
      if (reactivated.count !== 1) throw new Error("Account status changed while the hold was being lifted.");
    }
  }

  await tx.auditLog.create({ data: { actorId, action: "ACCOUNT_HOLD_LIFTED", targetType: "USER", targetId: userId } });
  return "lifted";
}

/** Record that an owner removed content a hold had captured, preserving the hold snapshot. */
export async function excludeContentFromHoldRestoration(
  tx: Tx,
  userId: string,
  kind: HeldContentKind,
  contentId: string,
) {
  await lockAccountForContentLifecycle(tx, userId);
  const holds = await tx.accountHold.findMany({
    where: { userId, active: true },
    select: { id: true, heldListingIds: true, heldShopIds: true, heldServiceIds: true, heldPropertyIds: true },
  });
  const field = heldIdsField[kind];

  for (const hold of holds) {
    const ids = idsFromJson(hold[field]);
    if (!ids.includes(contentId)) continue;
    await tx.auditLog.create({
      data: {
        actorId: userId,
        action: "ACCOUNT_HOLD_CONTENT_REMOVED",
        targetType: "ACCOUNT_HOLD",
        targetId: hold.id,
        metadata: { contentType: kind, contentId },
      },
    });
  }
}

export type OwnedContentRemovalResult = "account-ineligible" | "not-found" | "conflict" | "removed";
export type OwnedListingRemovalResult = OwnedContentRemovalResult;

/** Remove a listing only while its seller remains active under the shared lifecycle lock. */
export async function removeOwnedListing(
  tx: Tx,
  userId: string,
  contentId: string,
): Promise<OwnedListingRemovalResult> {
  await lockAccountForContentLifecycle(tx, userId);
  const seller = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (seller?.status !== "ACTIVE") return "account-ineligible";

  const listing = await tx.listing.findFirst({ where: { id: contentId, sellerId: userId }, select: { id: true, status: true } });
  if (!listing) return "not-found";
  const update = await tx.listing.updateMany({
    where: { id: contentId, sellerId: userId, status: listing.status },
    data: { status: "REMOVED" },
  });
  if (update.count !== 1) return "conflict";
  await excludeContentFromHoldRestoration(tx, userId, "LISTING", contentId);
  return "removed";
}

/** Remove owner content under the same seller lock used by holds and moderation. */
export async function removeOwnedContent(
  tx: Tx,
  kind: Exclude<HeldContentKind, "LISTING">,
  userId: string,
  contentId: string,
): Promise<OwnedContentRemovalResult> {
  await lockAccountForContentLifecycle(tx, userId);
  const seller = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (seller?.status !== "ACTIVE") return "account-ineligible";

  if (kind === "SHOP") {
    const row = await tx.shop.findFirst({ where: { id: contentId, ownerId: userId }, select: { id: true, status: true } });
    if (!row) return "not-found";
    if (row.status !== "REMOVED") {
      const update = await tx.shop.updateMany({ where: { id: contentId, ownerId: userId, status: row.status }, data: { status: "REMOVED" } });
      if (update.count !== 1) return "conflict";
    }
    await excludeContentFromHoldRestoration(tx, userId, kind, contentId);
    return "removed";
  }

  if (kind === "SERVICE") {
    const row = await tx.serviceListing.findFirst({ where: { id: contentId, providerId: userId }, select: { id: true, status: true } });
    if (!row) return "not-found";
    if (row.status !== "REMOVED") {
      const update = await tx.serviceListing.updateMany({ where: { id: contentId, providerId: userId, status: row.status }, data: { status: "REMOVED" } });
      if (update.count !== 1) return "conflict";
    }
    await excludeContentFromHoldRestoration(tx, userId, kind, contentId);
    return "removed";
  }

  const row = await tx.propertyListing.findFirst({ where: { id: contentId, ownerId: userId }, select: { id: true, status: true } });
  if (!row) return "not-found";
  if (row.status !== "REMOVED") {
    const update = await tx.propertyListing.updateMany({ where: { id: contentId, ownerId: userId, status: row.status }, data: { status: "REMOVED" } });
    if (update.count !== 1) return "conflict";
  }
  await excludeContentFromHoldRestoration(tx, userId, kind, contentId);
  return "removed";
}

/**
 * Restores exactly the content that a given hold hid, and nothing else. A row is only
 * restored if it is still REMOVED — anything a moderator independently REJECTED or
 * otherwise changed during the hold is skipped, so lifting a hold never overrides an
 * unrelated moderation decision.
 */
export async function restoreHeldContent(
  tx: Tx,
  hold: { id: string; userId: string; heldListingIds: unknown; heldShopIds: unknown; heldServiceIds: unknown; heldPropertyIds: unknown },
) {
  await lockAccountForContentLifecycle(tx, hold.userId);
  const provenHeld: Record<HeldContentKind, Set<string>> = {
    LISTING: new Set(),
    SHOP: new Set(),
    SERVICE: new Set(),
    PROPERTY: new Set(),
  };
  const ownerRemoved = {
    LISTING: new Set<string>(),
    SHOP: new Set<string>(),
    SERVICE: new Set<string>(),
    PROPERTY: new Set<string>(),
  };
  const [heldMarkers, removalMarkers] = await Promise.all([
    tx.auditLog.findMany({
      where: { action: "ACCOUNT_HOLD_CONTENT_HELD", targetType: "ACCOUNT_HOLD", targetId: hold.id },
      select: { metadata: true },
    }),
    tx.auditLog.findMany({
      where: { action: "ACCOUNT_HOLD_CONTENT_REMOVED", targetType: "ACCOUNT_HOLD", targetId: hold.id },
      select: { metadata: true },
    }),
  ]);
  for (const marker of heldMarkers) {
    const descriptor = holdContentDescriptor(marker.metadata);
    if (descriptor) provenHeld[descriptor.contentType].add(descriptor.contentId);
  }
  for (const marker of removalMarkers) {
    const descriptor = holdContentDescriptor(marker.metadata);
    if (descriptor) ownerRemoved[descriptor.contentType].add(descriptor.contentId);
  }

  const idsForRestore = (kind: HeldContentKind, value: unknown) => idsFromJson(value).filter((id) => {
    // Legacy snapshots have no positive proof that the hold performed the removal.
    // Never restore their REMOVED rows based on snapshot membership alone.
    return provenHeld[kind].has(id) && !ownerRemoved[kind].has(id);
  });
  const [listings, shops, services, properties] = await Promise.all([
    tx.listing.findMany({ where: { id: { in: idsForRestore("LISTING", hold.heldListingIds) }, sellerId: hold.userId }, select: { id: true, status: true } }),
    tx.shop.findMany({ where: { id: { in: idsForRestore("SHOP", hold.heldShopIds) }, ownerId: hold.userId }, select: { id: true, status: true } }),
    tx.serviceListing.findMany({ where: { id: { in: idsForRestore("SERVICE", hold.heldServiceIds) }, providerId: hold.userId }, select: { id: true, status: true } }),
    tx.propertyListing.findMany({ where: { id: { in: idsForRestore("PROPERTY", hold.heldPropertyIds) }, ownerId: hold.userId }, select: { id: true, status: true } }),
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
    listingIds.length ? tx.listing.updateMany({ where: { id: { in: listingIds }, sellerId: hold.userId, status: "REMOVED" }, data: { status: "ACTIVE" } }) : Promise.resolve(null),
    shopIds.length ? tx.shop.updateMany({ where: { id: { in: shopIds }, ownerId: hold.userId, status: "REMOVED" }, data: { status: "ACTIVE" } }) : Promise.resolve(null),
    serviceIds.length ? tx.serviceListing.updateMany({ where: { id: { in: serviceIds }, providerId: hold.userId, status: "REMOVED" }, data: { status: "ACTIVE" } }) : Promise.resolve(null),
    propertyIds.length ? tx.propertyListing.updateMany({ where: { id: { in: propertyIds }, ownerId: hold.userId, status: "REMOVED" }, data: { status: "ACTIVE" } }) : Promise.resolve(null),
  ]);
}

/** Count admins currently eligible to sign in, used to protect the final active admin. */
export async function countActiveAdmins(tx: Tx = prisma): Promise<number> {
  return tx.user.count({ where: { role: "ADMIN", status: "ACTIVE" } });
}
