import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, User } from "@prisma/client";
import { moderatePendingListing } from "../../src/lib/listing-moderation";
import { canPublishListing, publicListingWhere } from "../../src/lib/listing-visibility";

type SellerState = Pick<User, "status" | "flaggedForReview" | "profileVerification">;

function mockTx(seller: SellerState, options: { pending?: boolean; forceConflict?: boolean } = {}) {
  let listingStatus: "PENDING_REVIEW" | "ACTIVE" | "REJECTED" = options.pending === false ? "ACTIVE" : "PENDING_REVIEW";
  let updateWhere: Prisma.ListingWhereInput | null = null;
  const tx = {
    $queryRaw: async () => [],
    listing: {
      findFirst: async () => listingStatus === "PENDING_REVIEW"
        ? { sellerId: "seller-1", title: "Test listing", seller }
        : null,
      updateMany: async ({ where, data }: {
        where: Prisma.ListingWhereInput;
        data: { status: "ACTIVE" | "REJECTED" };
      }) => {
        updateWhere = where;
        if (options.forceConflict || listingStatus !== "PENDING_REVIEW") return { count: 0 };
        listingStatus = data.status;
        return { count: 1 };
      },
    },
  } as unknown as Pick<Prisma.TransactionClient, "listing" | "$queryRaw">;

  return {
    tx,
    get listingStatus() { return listingStatus; },
    get updateWhere() { return updateWhere; },
  };
}

test("public listings require an active listing and active seller", () => {
  assert.deepEqual(publicListingWhere(), {
    status: "ACTIVE",
    seller: { is: { status: "ACTIVE" } },
  });
});

test("an active unflagged seller is eligible to publish", () => {
  assert.equal(canPublishListing({ status: "ACTIVE", flaggedForReview: false, profileVerification: "VERIFIED" }, true), true);
});

test("suspended, deactivated, and banned sellers are ineligible to publish", () => {
  for (const status of ["SUSPENDED", "DEACTIVATED", "BANNED"] as const) {
    assert.equal(canPublishListing({ status, flaggedForReview: false, profileVerification: "VERIFIED" }, true), false, status);
  }
});

test("a review flag blocks new publication without hiding previously approved listings", () => {
  assert.equal(canPublishListing({ status: "ACTIVE", flaggedForReview: true, profileVerification: "VERIFIED" }, true), false);
  assert.deepEqual(publicListingWhere(), {
    status: "ACTIVE",
    seller: { is: { status: "ACTIVE" } },
  });
});

test("current profile verification is required for approval only when that gate is enabled", () => {
  const seller = { status: "ACTIVE", flaggedForReview: false, profileVerification: "NOT_VERIFIED" } as const;
  assert.equal(canPublishListing(seller, true), false);
  assert.equal(canPublishListing(seller, false), true);
});

test("a moderator cannot approve a pending listing for a suspended seller", async () => {
  const mock = mockTx({ status: "SUSPENDED", flaggedForReview: false, profileVerification: "VERIFIED" });
  assert.deepEqual(await moderatePendingListing(mock.tx, "listing-1", "APPROVE", true), { kind: "seller-ineligible" });
  assert.equal(mock.listingStatus, "PENDING_REVIEW");
  assert.equal(mock.updateWhere, null);
});

test("a moderator can reject a pending listing even when its seller is suspended", async () => {
  const mock = mockTx({ status: "SUSPENDED", flaggedForReview: false, profileVerification: "VERIFIED" });
  assert.deepEqual(await moderatePendingListing(mock.tx, "listing-1", "REJECT", true), {
    kind: "updated",
    sellerId: "seller-1",
    title: "Test listing",
    status: "REJECTED",
  });
  assert.equal(mock.listingStatus, "REJECTED");
  assert.deepEqual(mock.updateWhere, { id: "listing-1", sellerId: "seller-1", status: "PENDING_REVIEW" });
});

test("a moderator cannot approve a pending listing for a deactivated seller", async () => {
  const mock = mockTx({ status: "DEACTIVATED", flaggedForReview: false, profileVerification: "VERIFIED" });
  assert.deepEqual(await moderatePendingListing(mock.tx, "listing-1", "APPROVE", true), { kind: "seller-ineligible" });
  assert.equal(mock.listingStatus, "PENDING_REVIEW");
});

test("a moderator cannot approve a pending listing for a banned seller", async () => {
  const mock = mockTx({ status: "BANNED", flaggedForReview: false, profileVerification: "VERIFIED" });
  assert.deepEqual(await moderatePendingListing(mock.tx, "listing-1", "APPROVE", true), { kind: "seller-ineligible" });
  assert.equal(mock.listingStatus, "PENDING_REVIEW");
});

test("a flagged seller's pending listing cannot be approved", async () => {
  const mock = mockTx({ status: "ACTIVE", flaggedForReview: true, profileVerification: "VERIFIED" });
  assert.deepEqual(await moderatePendingListing(mock.tx, "listing-1", "APPROVE", true), { kind: "seller-ineligible" });
  assert.equal(mock.listingStatus, "PENDING_REVIEW");
});

test("an eligible seller's pending listing can be approved with an atomic eligibility predicate", async () => {
  const mock = mockTx({ status: "ACTIVE", flaggedForReview: false, profileVerification: "VERIFIED" });
  assert.deepEqual(await moderatePendingListing(mock.tx, "listing-1", "APPROVE", true), {
    kind: "updated",
    sellerId: "seller-1",
    title: "Test listing",
    status: "ACTIVE",
  });
  assert.equal(mock.listingStatus, "ACTIVE");
  assert.deepEqual(mock.updateWhere, {
    id: "listing-1",
    sellerId: "seller-1",
    status: "PENDING_REVIEW",
    seller: { is: { status: "ACTIVE", flaggedForReview: false, profileVerification: "VERIFIED" } },
  });
});

test("approval follows the existing profile-verification configuration", async () => {
  const mock = mockTx({ status: "ACTIVE", flaggedForReview: false, profileVerification: "NOT_VERIFIED" });
  assert.deepEqual(await moderatePendingListing(mock.tx, "listing-1", "APPROVE", false), {
    kind: "updated",
    sellerId: "seller-1",
    title: "Test listing",
    status: "ACTIVE",
  });
  assert.deepEqual(mock.updateWhere, {
    id: "listing-1",
    sellerId: "seller-1",
    status: "PENDING_REVIEW",
    seller: { is: { status: "ACTIVE", flaggedForReview: false } },
  });
});

test("a pending listing decision fails when the row changes before the conditional update", async () => {
  const mock = mockTx({ status: "ACTIVE", flaggedForReview: false, profileVerification: "VERIFIED" }, { forceConflict: true });
  assert.deepEqual(await moderatePendingListing(mock.tx, "listing-1", "APPROVE", true), { kind: "conflict" });
  assert.equal(mock.listingStatus, "PENDING_REVIEW");
});
