import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, User } from "@prisma/client";
import { lockAccountForContentLifecycle, restrictOwnedContent, restoreHeldContent } from "../../src/lib/account-lifecycle";
import { moderatePendingListing } from "../../src/lib/listing-moderation";

type ListingStatus = "ACTIVE" | "PENDING_REVIEW" | "REMOVED" | "REJECTED" | "SOLD";
type Seller = Pick<User, "status" | "flaggedForReview" | "profileVerification">;
type Listing = { id: string; sellerId: string; title: string; status: ListingStatus };
type Audit = { actorId: string; action: string; targetType: string; targetId: string; metadata: { contentType: string; contentId: string } };
type State = { seller: Seller; listings: Listing[]; audits: Audit[] };
type Where = {
  id?: string | { in?: string[] };
  sellerId?: string;
  status?: string;
  seller?: { is?: { status?: string; flaggedForReview?: boolean; profileVerification?: string } };
};

class Mutex {
  private tail = Promise.resolve();

  async acquire() {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    return release;
  }
}

function includesId(condition: Where["id"], id: string) {
  if (condition === undefined) return true;
  if (typeof condition === "string") return condition === id;
  return Array.isArray(condition.in) && condition.in.includes(id);
}

function makeTx(
  state: State,
  mutex: Mutex,
  hooks: { onLockAttempt?: () => void; onSecondListingRead?: () => Promise<void> } = {},
) {
  let release: (() => void) | undefined;
  let listingReads = 0;
  const tx = {
    $queryRaw: async (query: TemplateStringsArray, userId: string) => {
      assert.match(query.join(""), /FOR UPDATE/);
      assert.equal(userId, "seller-1");
      if (!release) {
        hooks.onLockAttempt?.();
        release = await mutex.acquire();
      }
      return [{ id: "seller-1" }];
    },
    listing: {
      findFirst: async ({ where }: { where: Where }) => {
        listingReads += 1;
        if (listingReads === 2) await hooks.onSecondListingRead?.();
        const row = state.listings.find((listing) => includesId(where.id, listing.id) && listing.status === where.status);
        return row ? { ...row, seller: state.seller } : null;
      },
      findMany: async ({ where }: { where: Where }) => state.listings
        .filter((listing) => listing.sellerId === where.sellerId && includesId(where.id, listing.id) && (where.status === undefined || listing.status === where.status))
        .map(({ id, status }) => ({ id, status })),
      updateMany: async ({ where, data }: { where: Where; data: { status: string } }) => {
        const eligible = where.seller?.is;
        const matched = state.listings.filter((listing) => {
          if (!includesId(where.id, listing.id) || (where.sellerId && listing.sellerId !== where.sellerId)) return false;
          if (where.status && listing.status !== where.status) return false;
          if (eligible && (state.seller.status !== eligible.status || state.seller.flaggedForReview !== eligible.flaggedForReview || (eligible.profileVerification && state.seller.profileVerification !== eligible.profileVerification))) return false;
          return true;
        });
        matched.forEach((listing) => { listing.status = data.status as ListingStatus; });
        return { count: matched.length };
      },
    },
    shop: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    serviceListing: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    propertyListing: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    auditLog: {
      findMany: async ({ where }: { where: { action: string; targetId: string } }) => state.audits
        .filter((audit) => audit.action === where.action && audit.targetId === where.targetId)
        .map(({ metadata }) => ({ metadata })),
      create: async ({ data }: { data: Audit }) => { state.audits.push(data); },
    },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, finish: () => release?.() };
}

async function inTransaction<T>(
  state: State,
  mutex: Mutex,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  hooks: { onLockAttempt?: () => void; onSecondListingRead?: () => Promise<void> } = {},
) {
  const transaction = makeTx(state, mutex, hooks);
  try {
    return await operation(transaction.tx);
  } finally {
    transaction.finish();
  }
}

function activeSeller(): Seller {
  return { status: "ACTIVE", flaggedForReview: false, profileVerification: "VERIFIED" };
}

async function recordHeldListing(tx: Prisma.TransactionClient, holdId: string, listingIds: string[]) {
  const auditLog = (tx as unknown as { auditLog: { create: (input: { data: Audit }) => Promise<unknown> } }).auditLog;
  for (const contentId of listingIds) {
    await auditLog.create({ data: { actorId: "admin", action: "ACCOUNT_HOLD_CONTENT_HELD", targetType: "ACCOUNT_HOLD", targetId: holdId, metadata: { contentType: "LISTING", contentId } } });
  }
}

test("a hold that wins the seller lock keeps a pending listing pending through lift", async () => {
  const state: State = { seller: activeSeller(), listings: [{ id: "pending-1", sellerId: "seller-1", title: "Pending", status: "PENDING_REVIEW" }], audits: [] };
  const mutex = new Mutex();
  let signalHoldLocked!: () => void;
  let continueHold!: () => void;
  let signalApprovalWaiting!: () => void;
  const holdLocked = new Promise<void>((resolve) => { signalHoldLocked = resolve; });
  const holdGate = new Promise<void>((resolve) => { continueHold = resolve; });
  const approvalWaits = new Promise<void>((resolve) => { signalApprovalWaiting = resolve; });

  const hold = inTransaction(state, mutex, async (tx) => {
    await lockAccountForContentLifecycle(tx, "seller-1");
    signalHoldLocked();
    await holdGate;
    const held = await restrictOwnedContent(tx, "seller-1");
    state.seller.status = "SUSPENDED";
    await recordHeldListing(tx, "hold-1", held.listingIds);
    return held;
  });
  await holdLocked;
  const approval = inTransaction(state, mutex, (tx) => moderatePendingListing(tx, "pending-1", "APPROVE", true), {
    onLockAttempt: signalApprovalWaiting,
  });
  await approvalWaits;
  continueHold();

  const held = await hold;
  const decision = await approval;
  assert.deepEqual(held.listingIds, []);
  assert.deepEqual(decision, { kind: "seller-ineligible" });
  assert.equal(state.listings[0].status, "PENDING_REVIEW");

  await inTransaction(state, mutex, async (tx) => {
    await restoreHeldContent(tx, { id: "hold-1", userId: "seller-1", heldListingIds: held.listingIds, heldShopIds: [], heldServiceIds: [], heldPropertyIds: [] });
    state.seller.status = "ACTIVE";
  });
  assert.equal(state.listings[0].status, "PENDING_REVIEW");
});

test("an approval that wins the seller lock is captured by the following hold and restored", async () => {
  const state: State = { seller: activeSeller(), listings: [{ id: "pending-1", sellerId: "seller-1", title: "Pending", status: "PENDING_REVIEW" }], audits: [] };
  const mutex = new Mutex();
  let signalApprovalLocked!: () => void;
  let finishApproval!: () => void;
  let signalHoldWaiting!: () => void;
  const approvalLocked = new Promise<void>((resolve) => { signalApprovalLocked = resolve; });
  const approvalGate = new Promise<void>((resolve) => { finishApproval = resolve; });
  const holdWaits = new Promise<void>((resolve) => { signalHoldWaiting = resolve; });

  const approval = inTransaction(state, mutex, (tx) => moderatePendingListing(tx, "pending-1", "APPROVE", true), {
    onSecondListingRead: async () => { signalApprovalLocked(); await approvalGate; },
  });
  await approvalLocked;
  const hold = inTransaction(state, mutex, async (tx) => {
    await lockAccountForContentLifecycle(tx, "seller-1");
    const held = await restrictOwnedContent(tx, "seller-1");
    await recordHeldListing(tx, "hold-2", held.listingIds);
    state.seller.status = "SUSPENDED";
    return held;
  }, { onLockAttempt: signalHoldWaiting });
  await holdWaits;
  finishApproval();

  assert.equal((await approval).kind, "updated");
  const held = await hold;
  assert.deepEqual(held.listingIds, ["pending-1"]);
  assert.equal(state.listings[0].status, "REMOVED");

  await inTransaction(state, mutex, async (tx) => {
    await restoreHeldContent(tx, { id: "hold-2", userId: "seller-1", heldListingIds: held.listingIds, heldShopIds: [], heldServiceIds: [], heldPropertyIds: [] });
    state.seller.status = "ACTIVE";
  });
  assert.equal(state.listings[0].status, "ACTIVE");
  assert.equal(state.seller.status, "ACTIVE");
});

test("hold restoration only restores active listings that the hold captured", async () => {
  const state: State = {
    seller: activeSeller(),
    audits: [],
    listings: [
      { id: "active-1", sellerId: "seller-1", title: "Active", status: "ACTIVE" },
      { id: "pending-1", sellerId: "seller-1", title: "Pending", status: "PENDING_REVIEW" },
      { id: "rejected-1", sellerId: "seller-1", title: "Rejected", status: "REJECTED" },
      { id: "removed-1", sellerId: "seller-1", title: "Removed", status: "REMOVED" },
    ],
  };
  const mutex = new Mutex();
  let held!: Awaited<ReturnType<typeof restrictOwnedContent>>;
  await inTransaction(state, mutex, async (tx) => {
    held = await restrictOwnedContent(tx, "seller-1");
    await recordHeldListing(tx, "hold-3", held.listingIds);
  });
  assert.deepEqual(held.listingIds, ["active-1"]);
  assert.deepEqual(state.listings.map(({ id, status }) => [id, status]), [
    ["active-1", "REMOVED"],
    ["pending-1", "PENDING_REVIEW"],
    ["rejected-1", "REJECTED"],
    ["removed-1", "REMOVED"],
  ]);

  await inTransaction(state, mutex, (tx) => restoreHeldContent(tx, {
    id: "hold-3",
    userId: "seller-1",
    heldListingIds: held.listingIds,
    heldShopIds: held.shopIds,
    heldServiceIds: held.serviceIds,
    heldPropertyIds: held.propertyIds,
  }));
  assert.deepEqual(state.listings.map(({ id, status }) => [id, status]), [
    ["active-1", "ACTIVE"],
    ["pending-1", "PENDING_REVIEW"],
    ["rejected-1", "REJECTED"],
    ["removed-1", "REMOVED"],
  ]);
});
