import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { removeOwnedContent, restoreHeldContent } from "../../src/lib/account-lifecycle";

type Kind = "SHOP" | "SERVICE" | "PROPERTY";
type Status = "ACTIVE" | "PENDING_REVIEW" | "REJECTED" | "SOLD" | "REMOVED";
type MockWhere = { id?: string; ownerId?: string; providerId?: string; status?: Status };

function makeTx(kind: Kind, initialStatus: Status, capturedByHold: boolean, sellerStatus = "ACTIVE") {
  const field = kind === "SHOP" ? "heldShopIds" : kind === "SERVICE" ? "heldServiceIds" : "heldPropertyIds";
  const ownerField = kind === "SERVICE" ? "providerId" : "ownerId";
  const state = {
    status: initialStatus,
    audits: [] as { action: string; targetType: string; targetId: string; metadata: { contentType: string; contentId: string } }[],
    hold: {
      id: "hold-1",
      userId: "seller-1",
      active: true,
      heldListingIds: [] as string[],
      heldShopIds: [] as string[],
      heldServiceIds: [] as string[],
      heldPropertyIds: [] as string[],
    },
  };
  if (capturedByHold) {
    state.status = "REMOVED";
    state.hold[field].push("entity-1");
    state.audits.push({
      action: "ACCOUNT_HOLD_CONTENT_HELD",
      targetType: "ACCOUNT_HOLD",
      targetId: state.hold.id,
      metadata: { contentType: kind, contentId: "entity-1" },
    });
  }

  const entityDelegate = {
    findFirst: async ({ where }: { where: MockWhere }) => {
      if (where.id !== "entity-1" || where[ownerField] !== "seller-1") return null;
      return { id: "entity-1", status: state.status };
    },
    findMany: async ({ where }: { where: { id?: { in?: string[] } } }) => {
      const ids = where.id?.in ?? [];
      return ids.includes("entity-1") ? [{ id: "entity-1", status: state.status }] : [];
    },
    updateMany: async ({ where, data }: { where: MockWhere; data: { status: Status } }) => {
      if (where.id !== "entity-1" || where[ownerField] !== "seller-1" || where.status !== state.status) return { count: 0 };
      state.status = data.status;
      return { count: 1 };
    },
  };
  const tx = {
    $queryRaw: async (query: TemplateStringsArray) => {
      assert.match(query.join(""), /FOR UPDATE/);
      return [{ id: "seller-1" }];
    },
    user: { findUnique: async () => ({ status: sellerStatus }) },
    listing: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    shop: kind === "SHOP" ? entityDelegate : { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    serviceListing: kind === "SERVICE" ? entityDelegate : { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    propertyListing: kind === "PROPERTY" ? entityDelegate : { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    accountHold: {
      findMany: async () => [{ ...state.hold }],
    },
    auditLog: {
      create: async ({ data }: { data: { action: string; targetType: string; targetId: string; metadata: { contentType: string; contentId: string } } }) => { state.audits.push(data); },
      findMany: async ({ where }: { where: { action: string; targetId: string } }) => state.audits
        .filter((row) => row.action === where.action && row.targetId === where.targetId)
        .map(({ metadata }) => ({ metadata })),
    },
  };

  return { tx: tx as unknown as Prisma.TransactionClient, state };
}

for (const kind of ["SHOP", "SERVICE", "PROPERTY"] as const) {
  test(`owner removal of a ${kind.toLowerCase()} during a hold prevents restoration`, async () => {
    const { tx, state } = makeTx(kind, "REMOVED", true);
    const result = await removeOwnedContent(tx, kind, "seller-1", "entity-1");
    assert.equal(result, "removed");
    assert.deepEqual(state.hold[fieldFor(kind)], ["entity-1"]);
    assert.deepEqual(state.audits.map((row) => row.action), ["ACCOUNT_HOLD_CONTENT_HELD", "ACCOUNT_HOLD_CONTENT_REMOVED"]);

    await restoreHeldContent(tx, state.hold);
    assert.equal(state.status, "REMOVED");
  });

  for (const previousStatus of ["PENDING_REVIEW", "REJECTED", "SOLD"] as const) {
    test(`a ${kind.toLowerCase()} previously ${previousStatus.toLowerCase()} is not captured for hold restoration`, async () => {
      const { tx, state } = makeTx(kind, previousStatus, false);
      assert.equal(await removeOwnedContent(tx, kind, "seller-1", "entity-1"), "removed");
      assert.equal(state.status, "REMOVED");
      await restoreHeldContent(tx, state.hold);
      assert.equal(state.status, "REMOVED");
    });
  }

  for (const sellerStatus of ["SUSPENDED", "BANNED", "DEACTIVATED"] as const) {
    test(`owner removal of a ${kind.toLowerCase()} is rejected when the seller is ${sellerStatus.toLowerCase()}`, async () => {
      const { tx, state } = makeTx(kind, "ACTIVE", false, sellerStatus);
      assert.equal(await removeOwnedContent(tx, kind, "seller-1", "entity-1"), "account-ineligible");
      assert.equal(state.status, "ACTIVE");
      assert.deepEqual(state.audits, []);
    });
  }
}

function fieldFor(kind: Kind) {
  return kind === "SHOP" ? "heldShopIds" : kind === "SERVICE" ? "heldServiceIds" : "heldPropertyIds";
}
