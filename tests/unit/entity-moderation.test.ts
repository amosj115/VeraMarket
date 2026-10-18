import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@prisma/client";
import { moderatePendingEntity, type ModeratedEntityType } from "../../src/lib/entity-moderation";
import { publicPropertyWhere, publicServiceWhere } from "../../src/lib/content-visibility";
import { activeShopFilter } from "../../src/lib/shops";

type Seller = Pick<User, "status" | "flaggedForReview" | "profileVerification">;
type EntityStatus = "PENDING_REVIEW" | "ACTIVE" | "REJECTED" | "REMOVED" | "SOLD";
type EntityState = { id: string; sellerId: string; title: string; status: EntityStatus };
type State = { seller: Seller; entity: EntityState };
type Hooks = { onInitialRead?: () => void | Promise<void>; afterLock?: () => void | Promise<void> };
type SellerWhere = { status?: string; flaggedForReview?: boolean; profileVerification?: string };
type MockWhere = { id?: string; status?: string; ownerId?: string; providerId?: string; owner?: { is?: SellerWhere }; provider?: { is?: SellerWhere } };

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

function makeTx(type: ModeratedEntityType, state: State, mutex: Mutex, hooks: Hooks = {}) {
  let release: (() => void) | undefined;
  let reads = 0;
  const parent = type === "SHOP" ? "owner" : type === "SERVICE" ? "provider" : "owner";
  const ownerField = type === "SERVICE" ? "providerId" : "ownerId";
  const nameField = type === "SHOP" ? "name" : "title";

  const findFirst = async ({ where }: { where: MockWhere }) => {
    reads += 1;
    if (reads === 1) await hooks.onInitialRead?.();
    if (where.id !== state.entity.id || where.status !== state.entity.status || (where[ownerField] && where[ownerField] !== state.entity.sellerId)) return null;
    return {
      [ownerField]: state.entity.sellerId,
      [nameField]: state.entity.title,
      [parent]: state.seller,
    };
  };

  const updateMany = async ({ where, data }: { where: MockWhere; data: { status: EntityStatus } }) => {
    if (where.id !== state.entity.id || where.status !== state.entity.status || (where[ownerField] && where[ownerField] !== state.entity.sellerId)) return { count: 0 };
    const eligibleSeller = where[parent]?.is;
    if (eligibleSeller && (
      state.seller.status !== eligibleSeller.status ||
      state.seller.flaggedForReview !== eligibleSeller.flaggedForReview ||
      (eligibleSeller.profileVerification && state.seller.profileVerification !== eligibleSeller.profileVerification)
    )) return { count: 0 };
    state.entity.status = data.status;
    return { count: 1 };
  };

  const delegate = { findFirst, updateMany };
  const tx = {
    $queryRaw: async (query: TemplateStringsArray) => {
      assert.match(query.join(""), /FOR UPDATE/);
      if (!release) {
        release = await mutex.acquire();
        await hooks.afterLock?.();
      }
      return [{ id: state.entity.sellerId }];
    },
    shop: delegate,
    serviceListing: delegate,
    propertyListing: delegate,
  };

  return { tx: tx as unknown as Parameters<typeof moderatePendingEntity>[0], finish: () => release?.() };
}

async function moderate(
  type: ModeratedEntityType,
  state: State,
  mutex = new Mutex(),
  decision: "APPROVE" | "REJECT" = "APPROVE",
  hooks: Hooks = {},
) {
  const transaction = makeTx(type, state, mutex, hooks);
  try {
    return await moderatePendingEntity(transaction.tx, type, state.entity.id, decision, true);
  } finally {
    transaction.finish();
  }
}

function pendingState(status: Seller["status"] = "ACTIVE"): State {
  return {
    seller: { status, flaggedForReview: false, profileVerification: "VERIFIED" },
    entity: { id: "entity-1", sellerId: "seller-1", title: "Test entity", status: "PENDING_REVIEW" },
  };
}

for (const type of ["SHOP", "SERVICE", "PROPERTY"] as const) {
  test(`${type.toLowerCase()} approval succeeds for an eligible seller`, async () => {
    const state = pendingState();
    assert.deepEqual(await moderate(type, state), { kind: "updated", sellerId: "seller-1", title: "Test entity", status: "ACTIVE" });
    assert.equal(state.entity.status, "ACTIVE");
  });

  for (const sellerStatus of ["SUSPENDED", "DEACTIVATED", "BANNED"] as const) {
    test(`${type.toLowerCase()} approval rejects a ${sellerStatus.toLowerCase()} seller`, async () => {
      const state = pendingState(sellerStatus);
      assert.deepEqual(await moderate(type, state), { kind: "seller-ineligible" });
      assert.equal(state.entity.status, "PENDING_REVIEW");
    });
  }

  test(`${type.toLowerCase()} rejection remains available for an ineligible seller`, async () => {
    const state = pendingState("SUSPENDED");
    assert.deepEqual(await moderate(type, state, new Mutex(), "REJECT"), { kind: "updated", sellerId: "seller-1", title: "Test entity", status: "REJECTED" });
    assert.equal(state.entity.status, "REJECTED");
  });

  test(`${type.toLowerCase()} moderation conflicts if the entity changes after its initial read`, async () => {
    const state = pendingState();
    assert.deepEqual(await moderate(type, state, new Mutex(), "APPROVE", { afterLock: () => { state.entity.status = "REMOVED"; } }), { kind: "conflict" });
    assert.equal(state.entity.status, "REMOVED");
  });

  test(`${type.toLowerCase()} approval and rejection serialize without overwriting`, async () => {
    const state = pendingState();
    const mutex = new Mutex();
    let signalLocked!: () => void;
    let allowApproval!: () => void;
    let signalRejectRead!: () => void;
    const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const approvalGate = new Promise<void>((resolve) => { allowApproval = resolve; });
    const rejectRead = new Promise<void>((resolve) => { signalRejectRead = resolve; });

    const approval = moderate(type, state, mutex, "APPROVE", { afterLock: async () => { signalLocked(); await approvalGate; } });
    await locked;
    const rejection = moderate(type, state, mutex, "REJECT", { onInitialRead: signalRejectRead });
    await rejectRead;
    allowApproval();

    assert.equal((await approval).kind, "updated");
    assert.equal((await rejection).kind, "conflict");
    assert.equal(state.entity.status, "ACTIVE");
  });
}

test("public Shop, Service, and Property predicates require active owner accounts", () => {
  assert.deepEqual(publicServiceWhere(), { status: "ACTIVE", provider: { is: { status: "ACTIVE" } } });
  assert.deepEqual(publicPropertyWhere(), { status: "ACTIVE", owner: { is: { status: "ACTIVE" } } });
  assert.deepEqual(activeShopFilter(new Date("2026-01-01T00:00:00Z")).owner, { is: { status: "ACTIVE" } });
});
