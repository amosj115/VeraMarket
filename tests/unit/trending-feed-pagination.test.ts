import assert from "node:assert/strict";
import test from "node:test";
import {
  getTrendingFeedPage,
  TRENDING_FEED_PAGE_SIZE,
  type TrendingFeedItem,
  type TrendingFeedQuery,
} from "../../src/lib/trending-feed";
import { parseTrendingCursor, type TrendingCursor } from "../../src/lib/trending-cursor";

type QueryRow = Awaited<ReturnType<TrendingFeedQuery>>[number];
type FixtureListing = Omit<QueryRow, "boosts"> & {
  status: "ACTIVE" | "REMOVED";
  sellerStatus: "ACTIVE" | "SUSPENDED";
  boostRecords: Array<{ id: string; status: "ACTIVE" | "PENDING"; expiresAt: Date }>;
};

function makeListing(
  id: string,
  createdAt: Date,
  options: Partial<Pick<FixtureListing, "status" | "sellerStatus" | "boostRecords">> = {},
): FixtureListing {
  return {
    id,
    slug: id,
    title: `Listing ${id}`,
    priceCents: 1000,
    condition: "GOOD",
    location: "Cape Town",
    areaName: null,
    createdAt,
    images: [],
    seller: { id: `seller-${id}`, displayName: "Seller", username: id, avatarUrl: null },
    status: "ACTIVE",
    sellerStatus: "ACTIVE",
    boostRecords: [],
    ...options,
  };
}

function createFindListings(
  fixtures: FixtureListing[],
  expectedCursor: TrendingCursor | undefined,
  calls: number[],
): TrendingFeedQuery {
  return async (args) => {
    calls.push(1);
    assert.deepEqual(args.where, {
      status: "ACTIVE",
      seller: { is: { status: "ACTIVE" } },
      ...(expectedCursor
        ? {
            OR: [
              { createdAt: { lt: expectedCursor.createdAt } },
              { createdAt: expectedCursor.createdAt, id: { lt: expectedCursor.id } },
            ],
          }
        : {}),
    });
    assert.deepEqual(args.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
    assert.equal(args.take, TRENDING_FEED_PAGE_SIZE + 1);

    const boostSelection = args.select.boosts;
    assert.notEqual(boostSelection, true);
    if (boostSelection === true) throw new Error("Expected filtered boost selection.");
    assert.equal(boostSelection.where?.status, "ACTIVE");
    const boostExpiry = boostSelection.where?.expiresAt;
    assert.ok(boostExpiry && "gt" in boostExpiry && boostExpiry.gt instanceof Date);

    return fixtures
      .filter((listing) => listing.status === "ACTIVE" && listing.sellerStatus === "ACTIVE")
      .filter((listing) => !expectedCursor
        || listing.createdAt < expectedCursor.createdAt
        || (listing.createdAt.getTime() === expectedCursor.createdAt.getTime() && listing.id < expectedCursor.id))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, args.take)
      .map(({ status: _status, sellerStatus: _sellerStatus, boostRecords, ...listing }) => ({
        ...listing,
        boosts: boostRecords
          .filter((boost) => boost.status === boostSelection.where?.status && boost.expiresAt > boostExpiry.gt)
          .slice(0, boostSelection.take ?? undefined)
          .map(({ id: boostId }) => ({ id: boostId })),
      }));
  };
}

test("getTrendingFeedPage returns every eligible listing once with stable keyset pagination", async () => {
  const baseTime = Date.parse("2026-10-18T12:00:00.000Z");
  const fixtures = Array.from({ length: 60 }, (_, index) => {
    const boostRecords = index === 0
      ? [{ id: "boost-active", status: "ACTIVE" as const, expiresAt: new Date(Date.now() + 60_000) }]
      : index === 1
        ? [{ id: "boost-expired", status: "ACTIVE" as const, expiresAt: new Date(Date.now() - 60_000) }]
        : index === 2
          ? [{ id: "boost-pending", status: "PENDING" as const, expiresAt: new Date(Date.now() + 60_000) }]
          : [];
    return makeListing(
      `listing-${String(index).padStart(3, "0")}`,
      new Date(baseTime - Math.floor(index / 3) * 1000),
      { boostRecords },
    );
  }).reverse();
  fixtures.push(
    makeListing("listing-removed", new Date(baseTime + 60_000), { status: "REMOVED" }),
    makeListing("listing-suspended-seller", new Date(baseTime + 60_000), { sellerStatus: "SUSPENDED" }),
  );

  const expected = fixtures
    .filter((listing) => listing.status === "ACTIVE" && listing.sellerStatus === "ACTIVE")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const returned: TrendingFeedItem[] = [];
  const calls: number[] = [];
  let cursor: TrendingCursor | undefined;
  let pages = 0;

  while (true) {
    const page = await getTrendingFeedPage(cursor, createFindListings(fixtures, cursor, calls));
    assert.ok(page.items.length <= TRENDING_FEED_PAGE_SIZE);
    returned.push(...page.items);
    pages++;

    if (page.items.length === 0 || returned.length === expected.length) {
      assert.equal(page.nextCursor, null);
      break;
    }

    assert.ok(page.nextCursor, "a non-final page must have a cursor");
    const decodedCursor = parseTrendingCursor(page.nextCursor);
    assert.ok(decodedCursor);
    const lastReturned = page.items[page.items.length - 1];
    assert.deepEqual(decodedCursor, { createdAt: expected[returned.length - 1].createdAt, id: lastReturned.id });
    cursor = decodedCursor;
    assert.ok(pages <= expected.length, "pagination must terminate");
  }

  assert.equal(expected.length, 60);
  assert.equal(pages, Math.ceil(expected.length / TRENDING_FEED_PAGE_SIZE));
  assert.equal(calls.length, pages);
  assert.equal(returned.length, expected.length);
  assert.deepEqual(returned.map((listing) => listing.id), expected.map((listing) => listing.id));
  assert.equal(new Set(returned.map((listing) => listing.id)).size, expected.length);
  assert.equal(returned.find((listing) => listing.id === "listing-000")?.boosted, true);
  assert.equal(returned.find((listing) => listing.id === "listing-001")?.boosted, false);
  assert.equal(returned.find((listing) => listing.id === "listing-002")?.boosted, false);
  assert.ok(!returned.some((listing) => listing.id === "listing-removed" || listing.id === "listing-suspended-seller"));
});
