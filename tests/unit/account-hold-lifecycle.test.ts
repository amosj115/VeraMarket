import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { liftAccountHold, placeAccountHold, removeOwnedContent, removeOwnedListing } from "../../src/lib/account-lifecycle";

type Status = "ACTIVE" | "SUSPENDED" | "BANNED" | "DEACTIVATED" | "PENDING_REVIEW" | "REJECTED" | "SOLD" | "REMOVED";
type ContentStatus = Extract<Status, "ACTIVE" | "PENDING_REVIEW" | "REJECTED" | "SOLD" | "REMOVED">;
type MockUser = { id: string; role: "USER" | "ADMIN"; status: Status; email: string };
type MockContent = { id: string; userId: string; status: ContentStatus };
type MockHold = {
  id: string;
  userId: string;
  active: boolean;
  placedAt: Date;
  liftedById: string | null;
  liftedAt: Date | null;
  heldListingIds: unknown;
  heldShopIds: unknown;
  heldServiceIds: unknown;
  heldPropertyIds: unknown;
};
type MockAudit = { actorId: string; action: string; targetType: string; targetId: string; metadata?: Record<string, unknown> };
type State = {
  users: MockUser[];
  holds: MockHold[];
  listings: MockContent[];
  shops: MockContent[];
  services: MockContent[];
  properties: MockContent[];
  audits: MockAudit[];
};
type Where = {
  id?: string | { in?: string[] };
  userId?: string;
  active?: boolean;
  status?: ContentStatus | "SUSPENDED";
  sellerId?: string;
  ownerId?: string;
  providerId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
};
type Data = {
  status?: Status;
  active?: boolean;
  liftedById?: string;
  liftedAt?: Date;
  heldListingIds?: string[];
  heldShopIds?: string[];
  heldServiceIds?: string[];
  heldPropertyIds?: string[];
};

class KeyedMutex {
  private readonly entries = new Map<string, { locked: boolean; queue: Array<() => void> }>();

  async acquire(key: string): Promise<() => void> {
    const entry = this.entries.get(key) ?? { locked: false, queue: [] };
    this.entries.set(key, entry);
    if (!entry.locked) {
      entry.locked = true;
      return () => this.release(key, entry);
    }
    await new Promise<void>((resolve) => entry.queue.push(resolve));
    return () => this.release(key, entry);
  }

  private release(key: string, entry: { locked: boolean; queue: Array<() => void> }) {
    const next = entry.queue.shift();
    if (next) next();
    else {
      entry.locked = false;
      this.entries.delete(key);
    }
  }
}

function makeState(users: MockUser[], contents: Partial<Pick<State, "listings" | "shops" | "services" | "properties">> = {}): State {
  return {
    users,
    holds: [],
    listings: contents.listings ?? [],
    shops: contents.shops ?? [],
    services: contents.services ?? [],
    properties: contents.properties ?? [],
    audits: [],
  };
}

function makeTransaction(state: State, locks: KeyedMutex, hooks: { onUserLocked?: () => Promise<void> } = {}) {
  const heldLocks = new Set<string>();
  const releases: Array<() => void> = [];
  const matchesId = (condition: Where["id"], id: string) => {
    if (condition === undefined) return true;
    if (typeof condition === "string") return condition === id;
    return condition.in?.includes(id) ?? false;
  };
  const filterContent = (rows: MockContent[], where: Where) => rows.filter((row) => {
    const ownerId = where.sellerId ?? where.ownerId ?? where.providerId;
    return matchesId(where.id, row.id) && (!ownerId || row.userId === ownerId) && (!where.status || row.status === where.status);
  });
  const contentDelegate = (rows: MockContent[]) => ({
    findFirst: async ({ where }: { where: Where }) => {
      const row = filterContent(rows, where)[0];
      return row ? { id: row.id, status: row.status } : null;
    },
    findMany: async ({ where }: { where: Where }) => filterContent(rows, where).map(({ id, status }) => ({ id, status })),
    updateMany: async ({ where, data }: { where: Where; data: Data }) => {
      const matched = filterContent(rows, where);
      if (data.status) matched.forEach((row) => { row.status = data.status as ContentStatus; });
      return { count: matched.length };
    },
  });

  const tx = {
    $queryRaw: async (query: TemplateStringsArray, ...values: unknown[]) => {
      const sql = query.join("");
      const key = sql.includes("pg_advisory_xact_lock") ? "admin-roster" : `user:${String(values[0])}`;
      if (!sql.includes("pg_advisory_xact_lock")) assert.match(sql, /FOR UPDATE/);
      if (!heldLocks.has(key)) {
        heldLocks.add(key);
        releases.push(await locks.acquire(key));
        if (key.startsWith("user:")) await hooks.onUserLocked?.();
      }
      return [];
    },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const user = state.users.find((row) => row.id === where.id);
        return user ? { ...user } : null;
      },
      count: async ({ where }: { where: { role: string; status: string } }) => state.users.filter((user) => user.role === where.role && user.status === where.status).length,
      update: async ({ where, data }: { where: { id: string }; data: Data }) => {
        const user = state.users.find((row) => row.id === where.id);
        if (!user) throw new Error("Missing mock user");
        if (data.status) user.status = data.status;
        return { ...user };
      },
      updateMany: async ({ where, data }: { where: { id: string; status: Status }; data: Data }) => {
        const user = state.users.find((row) => row.id === where.id && row.status === where.status);
        if (!user) return { count: 0 };
        if (data.status) user.status = data.status;
        return { count: 1 };
      },
    },
    accountHold: {
      count: async ({ where }: { where: { userId: string; active: boolean } }) => state.holds.filter((hold) => hold.userId === where.userId && hold.active === where.active).length,
      create: async ({ data }: { data: Omit<MockHold, "id" | "active" | "placedAt" | "liftedById" | "liftedAt"> }) => {
        const hold: MockHold = { ...data, id: `hold-${state.holds.length + 1}`, active: true, placedAt: new Date(Date.now() + state.holds.length), liftedById: null, liftedAt: null };
        state.holds.push(hold);
        return hold;
      },
      findFirst: async ({ where }: { where: Where }) => state.holds.find((hold) => matchesId(where.id, hold.id) && hold.userId === where.userId && (where.active === undefined || hold.active === where.active)) ?? null,
      findMany: async ({ where, orderBy }: { where: Where; orderBy?: Array<Record<string, "asc" | "desc">> }) => {
        const holds = state.holds.filter((hold) => hold.userId === where.userId && (where.active === undefined || hold.active === where.active));
        if (orderBy) holds.sort((left, right) => left.placedAt.getTime() - right.placedAt.getTime() || left.id.localeCompare(right.id));
        return holds;
      },
      updateMany: async ({ where, data }: { where: Where; data: Data }) => {
        const matched = state.holds.filter((hold) => matchesId(where.id, hold.id) && hold.userId === where.userId && (where.active === undefined || hold.active === where.active));
        matched.forEach((hold) => Object.assign(hold, data));
        return { count: matched.length };
      },
      update: async ({ where, data }: { where: { id: string }; data: Data }) => {
        const hold = state.holds.find((row) => row.id === where.id);
        if (!hold) throw new Error("Missing mock hold");
        Object.assign(hold, data);
        return hold;
      },
    },
    listing: contentDelegate(state.listings),
    shop: contentDelegate(state.shops),
    serviceListing: contentDelegate(state.services),
    propertyListing: contentDelegate(state.properties),
    auditLog: {
      findMany: async ({ where }: { where: Where }) => state.audits
        .filter((row) => row.action === where.action && row.targetType === where.targetType && row.targetId === where.targetId)
        .map((row) => ({ actorId: row.actorId, metadata: row.metadata })),
      create: async ({ data }: { data: MockAudit }) => { state.audits.push(data); },
      createMany: async ({ data }: { data: MockAudit[] }) => { state.audits.push(...data); return { count: data.length }; },
    },
  };

  return {
    tx: tx as unknown as Prisma.TransactionClient,
    finish: () => { for (const release of releases.reverse()) release(); },
  };
}

async function inTransaction<T>(
  state: State,
  locks: KeyedMutex,
  action: (tx: Prisma.TransactionClient) => Promise<T>,
  hooks: { onUserLocked?: () => Promise<void> } = {},
) {
  const transaction = makeTransaction(state, locks, hooks);
  try {
    return await action(transaction.tx);
  } finally {
    transaction.finish();
  }
}

function user(id: string, role: MockUser["role"] = "USER", status: Status = "ACTIVE"): MockUser {
  return { id, role, status, email: `${id}@example.test` };
}

function hold(id: string, userId: string, heldListingIds: string[], heldShopIds: string[] = [], heldServiceIds: string[] = [], heldPropertyIds: string[] = [], placedAt = 0): MockHold {
  return {
    id,
    userId,
    active: true,
    placedAt: new Date(placedAt),
    liftedById: null,
    liftedAt: null,
    heldListingIds,
    heldShopIds,
    heldServiceIds,
    heldPropertyIds,
  };
}

function recordHeld(state: State, holdId: string, contentType: HeldContentKind, contentIds: string[], actorId = "admin") {
  for (const contentId of contentIds) {
    state.audits.push({
      actorId,
      action: "ACCOUNT_HOLD_CONTENT_HELD",
      targetType: "ACCOUNT_HOLD",
      targetId: holdId,
      metadata: { contentType, contentId },
    });
  }
}

function recordOwnerRemoval(state: State, holdId: string, contentType: HeldContentKind, contentId: string) {
  state.audits.push({
    actorId: "seller",
    action: "ACCOUNT_HOLD_CONTENT_REMOVED",
    targetType: "ACCOUNT_HOLD",
    targetId: holdId,
    metadata: { contentType, contentId },
  });
}

type HeldContentKind = "LISTING" | "SHOP" | "SERVICE" | "PROPERTY";

test("a normal hold records positive provenance and restores its active listing, shop, service, and property", async () => {
  const state = makeState([user("seller")], {
    listings: [
      { id: "active", userId: "seller", status: "ACTIVE" },
      { id: "pending", userId: "seller", status: "PENDING_REVIEW" },
    ],
    shops: [{ id: "shop", userId: "seller", status: "ACTIVE" }],
    services: [{ id: "service", userId: "seller", status: "ACTIVE" }],
    properties: [{ id: "property", userId: "seller", status: "ACTIVE" }],
  });
  const locks = new KeyedMutex();

  const placed = await inTransaction(state, locks, (tx) => placeAccountHold(tx, "seller", "admin", "review"));
  assert.equal(placed.kind, "held");
  assert.deepEqual(state.listings.map(({ id, status }) => [id, status]), [["active", "REMOVED"], ["pending", "PENDING_REVIEW"]]);
  const placedHold = state.holds[0];
  assert.deepEqual(state.audits.filter((row) => row.action === "ACCOUNT_HOLD_CONTENT_HELD").map((row) => [row.targetId, row.metadata?.contentType, row.metadata?.contentId]), [
    [placedHold.id, "LISTING", "active"],
    [placedHold.id, "SHOP", "shop"],
    [placedHold.id, "SERVICE", "service"],
    [placedHold.id, "PROPERTY", "property"],
  ]);
  assert.deepEqual([state.shops[0].status, state.services[0].status, state.properties[0].status], ["REMOVED", "REMOVED", "REMOVED"]);

  const lifted = await inTransaction(state, locks, (tx) => liftAccountHold(tx, "seller", placedHold.id, "admin"));
  assert.equal(lifted, "lifted");
  assert.equal(state.users[0].status, "ACTIVE");
  assert.deepEqual(state.listings.map(({ id, status }) => [id, status]), [["active", "ACTIVE"], ["pending", "PENDING_REVIEW"]]);
  assert.deepEqual([state.shops[0].status, state.services[0].status, state.properties[0].status], ["ACTIVE", "ACTIVE", "ACTIVE"]);
});

test("legacy snapshots without positive hold markers remain removed", async () => {
  const state = makeState([user("seller", "USER", "SUSPENDED")], {
    listings: [{ id: "legacy-listing", userId: "seller", status: "REMOVED" }],
    shops: [{ id: "legacy-shop", userId: "seller", status: "REMOVED" }],
    services: [{ id: "legacy-service", userId: "seller", status: "REMOVED" }],
    properties: [{ id: "legacy-property", userId: "seller", status: "REMOVED" }],
  });
  state.holds.push(hold("legacy", "seller", ["legacy-listing"], ["legacy-shop"], ["legacy-service"], ["legacy-property"]));
  const locks = new KeyedMutex();

  assert.equal(await inTransaction(state, locks, (tx) => liftAccountHold(tx, "seller", "legacy", "admin")), "lifted");
  assert.equal(state.users[0].status, "ACTIVE");
  assert.deepEqual([state.listings[0].status, state.shops[0].status, state.services[0].status, state.properties[0].status], ["REMOVED", "REMOVED", "REMOVED", "REMOVED"]);
});

test("overlapping holds transfer positive provenance and owner-removal exclusions in either lift order", async () => {
  for (const order of [["newer", "older"], ["older", "newer"]] as const) {
    const rows = (kind: string): MockContent[] => [
      { id: `${kind}-older`, userId: "seller", status: "REMOVED" },
      { id: `${kind}-newer`, userId: "seller", status: "REMOVED" },
      { id: `${kind}-owner-removed`, userId: "seller", status: "REMOVED" },
      { id: `${kind}-legacy`, userId: "seller", status: "REMOVED" },
      { id: `${kind}-pending`, userId: "seller", status: "PENDING_REVIEW" },
      { id: `${kind}-rejected`, userId: "seller", status: "REJECTED" },
      { id: `${kind}-sold`, userId: "seller", status: "SOLD" },
    ];
    const state = makeState([user("seller", "USER", "SUSPENDED")], {
      listings: rows("listing"),
      shops: rows("shop"),
      services: rows("service"),
      properties: rows("property"),
    });
    state.holds.push(
      hold("older", "seller", ["listing-older", "listing-legacy", "listing-pending", "listing-rejected", "listing-sold"], ["shop-older", "shop-legacy", "shop-pending", "shop-rejected", "shop-sold"], ["service-older", "service-legacy", "service-pending", "service-rejected", "service-sold"], ["property-older", "property-legacy", "property-pending", "property-rejected", "property-sold"], 1),
      hold("newer", "seller", ["listing-newer", "listing-owner-removed"], ["shop-newer", "shop-owner-removed"], ["service-newer", "service-owner-removed"], ["property-newer", "property-owner-removed"], 2),
    );
    for (const kind of ["LISTING", "SHOP", "SERVICE", "PROPERTY"] as const) {
      const prefix = kind.toLowerCase();
      recordHeld(state, "older", kind, [`${prefix}-older`, `${prefix}-pending`, `${prefix}-rejected`, `${prefix}-sold`]);
      recordHeld(state, "newer", kind, [`${prefix}-newer`, `${prefix}-owner-removed`]);
      recordOwnerRemoval(state, "newer", kind, `${prefix}-owner-removed`);
    }
    const locks = new KeyedMutex();

    for (const holdId of order) {
      assert.equal(await inTransaction(state, locks, (tx) => liftAccountHold(tx, "seller", holdId, "admin")), "lifted");
    }
    assert.equal(state.users[0].status, "ACTIVE");
    for (const kind of ["listings", "shops", "services", "properties"] as const) {
      const contentType = kind === "listings" ? "listing" : kind === "shops" ? "shop" : kind === "services" ? "service" : "property";
      const actual = state[kind].map(({ id, status }) => [id, status]);
      assert.deepEqual(actual, [
        [`${contentType}-older`, "ACTIVE"],
        [`${contentType}-newer`, "ACTIVE"],
        [`${contentType}-owner-removed`, "REMOVED"],
        [`${contentType}-legacy`, "REMOVED"],
        [`${contentType}-pending`, "PENDING_REVIEW"],
        [`${contentType}-rejected`, "REJECTED"],
        [`${contentType}-sold`, "SOLD"],
      ], `${kind} should preserve positive provenance, owner-removal exclusions, and later status changes for lift order ${order.join(" then ")}`);
    }
  }
});

test("owner removals waiting behind hold placement are rejected and held content restores", async () => {
  const state = makeState([user("seller")], {
    listings: [{ id: "listing", userId: "seller", status: "ACTIVE" }],
    shops: [{ id: "shop", userId: "seller", status: "ACTIVE" }],
    services: [{ id: "service", userId: "seller", status: "ACTIVE" }],
    properties: [{ id: "property", userId: "seller", status: "ACTIVE" }],
  });
  const locks = new KeyedMutex();
  let signalLocked!: () => void;
  let releaseHold!: () => void;
  const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
  const holdGate = new Promise<void>((resolve) => { releaseHold = resolve; });

  const placing = inTransaction(state, locks, (tx) => placeAccountHold(tx, "seller", "admin", "review"), {
    onUserLocked: async () => { signalLocked(); await holdGate; },
  });
  await locked;
  const removals = Promise.all([
    inTransaction(state, locks, (tx) => removeOwnedListing(tx, "seller", "listing")),
    inTransaction(state, locks, (tx) => removeOwnedContent(tx, "SHOP", "seller", "shop")),
    inTransaction(state, locks, (tx) => removeOwnedContent(tx, "SERVICE", "seller", "service")),
    inTransaction(state, locks, (tx) => removeOwnedContent(tx, "PROPERTY", "seller", "property")),
  ]);
  releaseHold();

  assert.equal((await placing).kind, "held");
  assert.deepEqual(await removals, ["account-ineligible", "account-ineligible", "account-ineligible", "account-ineligible"]);
  const held = state.holds[0];
  assert.equal(await inTransaction(state, locks, (tx) => liftAccountHold(tx, "seller", held.id, "admin")), "lifted");
  assert.deepEqual([state.listings[0].status, state.shops[0].status, state.services[0].status, state.properties[0].status], ["ACTIVE", "ACTIVE", "ACTIVE", "ACTIVE"]);
  assert.equal(state.audits.some((row) => row.targetId === held.id && row.action === "ACCOUNT_HOLD_CONTENT_REMOVED"), false);
});

test("banned and deactivated accounts do not restore held content on the final lift", async () => {
  for (const status of ["BANNED", "DEACTIVATED"] as const) {
    const state = makeState([user("seller", "USER", status)], {
      listings: [{ id: "held", userId: "seller", status: "REMOVED" }],
      shops: [{ id: "shop", userId: "seller", status: "REMOVED" }],
      services: [{ id: "service", userId: "seller", status: "REMOVED" }],
      properties: [{ id: "property", userId: "seller", status: "REMOVED" }],
    });
    state.holds.push(hold("hold", "seller", ["held"], ["shop"], ["service"], ["property"]));
    recordHeld(state, "hold", "LISTING", ["held"]);
    recordHeld(state, "hold", "SHOP", ["shop"]);
    recordHeld(state, "hold", "SERVICE", ["service"]);
    recordHeld(state, "hold", "PROPERTY", ["property"]);
    const locks = new KeyedMutex();

    assert.equal(await inTransaction(state, locks, (tx) => liftAccountHold(tx, "seller", "hold", "admin")), "lifted");
    assert.equal(state.users[0].status, status);
    assert.deepEqual([state.listings[0].status, state.shops[0].status, state.services[0].status, state.properties[0].status], ["REMOVED", "REMOVED", "REMOVED", "REMOVED"]);
  }
});

test("concurrent hold requests for one seller serialize and create only one active hold", async () => {
  const state = makeState([user("seller")], {
    listings: [{ id: "active", userId: "seller", status: "ACTIVE" }],
  });
  const locks = new KeyedMutex();
  const attempts = await Promise.all([
    inTransaction(state, locks, (tx) => placeAccountHold(tx, "seller", "admin-a", "review a")),
    inTransaction(state, locks, (tx) => placeAccountHold(tx, "seller", "admin-b", "review b")),
  ]);

  assert.equal(attempts.filter((result) => result.kind === "held").length, 1);
  assert.equal(attempts.filter((result) => result.kind === "ineligible" && result.status === "SUSPENDED").length, 1);
  assert.equal(state.holds.filter((row) => row.active).length, 1);
  assert.equal(state.users[0].status, "SUSPENDED");
});

test("competing holds on different admin accounts cannot suspend the final active admin", async () => {
  const state = makeState([user("admin-a", "ADMIN"), user("admin-b", "ADMIN")]);
  const locks = new KeyedMutex();
  const attempts = await Promise.all([
    inTransaction(state, locks, (tx) => placeAccountHold(tx, "admin-a", "admin-b", "review a")),
    inTransaction(state, locks, (tx) => placeAccountHold(tx, "admin-b", "admin-a", "review b")),
  ]);

  assert.equal(attempts.filter((result) => result.kind === "held").length, 1);
  assert.equal(attempts.filter((result) => result.kind === "last-active-admin").length, 1);
  assert.equal(state.users.filter((row) => row.role === "ADMIN" && row.status === "ACTIVE").length, 1);
  assert.equal(state.holds.filter((row) => row.active).length, 1);
});
