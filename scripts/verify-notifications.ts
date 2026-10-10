import "dotenv/config";
import "./db-guard";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/security/password";
import { createNotifications, notifyContentPublished } from "../src/lib/notifications";

const BASE = process.env.VERIFY_BASE ?? "http://localhost:3000";
const prisma = new PrismaClient();
const run = Date.now().toString(36);
const PASSWORD = "Passw0rdTest1";
let failures = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` -> ${JSON.stringify(detail)}`}`);
}

class Client {
  cookies = new Map<string, string>();
  constructor(public email: string) {}
  private store(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const idx = pair.indexOf("=");
      this.cookies.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
  }
  private header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
  async login() {
    this.cookies.clear();
    const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
    this.store(csrfRes);
    const { csrfToken } = await csrfRes.json();
    const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: this.header() },
      body: new URLSearchParams({ csrfToken, email: this.email, password: PASSWORD, json: "true" }),
    });
    this.store(res);
    const session = await (await this.req("/api/auth/session")).json();
    if (!session?.user) throw new Error(`login failed for ${this.email}`);
  }
  req(path: string, init: RequestInit = {}) {
    return fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", Cookie: this.header(), ...(init.headers ?? {}) } });
  }
  async json(path: string, init: RequestInit = {}) {
    const res = await this.req(path, init);
    return { status: res.status, body: await res.json().catch(() => null) };
  }
}

async function makeUser(tag: string, location: string | null, role: "USER" | "ADMIN" = "USER") {
  const email = `nc-test-${run}-${tag}@example.test`;
  const user = await prisma.user.create({
    data: { email, displayName: `NC ${tag.toUpperCase()}`, username: `nc_${run}_${tag}`, passwordHash: await hashPassword(PASSWORD), location, role, emailVerifiedAt: new Date(), profileVerification: "VERIFIED" },
  });
  return { user, client: new Client(email) };
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: `nc-test-${run}-` } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  // Fixture fan-outs can deliver to REAL users (any account with a matching recent
  // search in the shared database). Remove every notification that references a
  // fixture listing or fixture property, no matter the recipient, before the rows
  // cascade away — otherwise production accounts keep orphaned test notifications.
  const fixtureListings = await prisma.listing.findMany({ where: { sellerId: { in: ids } }, select: { id: true } });
  if (fixtureListings.length) {
    await prisma.notification.deleteMany({ where: { relatedListingId: { in: fixtureListings.map((l) => l.id) } } });
  }
  const fixtureProps = await prisma.propertyListing.findMany({ where: { ownerId: { in: ids } }, select: { id: true } });
  if (fixtureProps.length) {
    await prisma.notification.deleteMany({ where: { relatedPropertyId: { in: fixtureProps.map((p) => p.id) } } });
  }
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.searchActivity.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  const category = await prisma.category.findFirst({ where: { domain: "MARKETPLACE" } });
  if (!category) throw new Error("No marketplace category in DB");

  const A = await makeUser("a", "Pretoria");
  const B = await makeUser("b", null);
  const C = await makeUser("c", null);
  const D = await makeUser("d", "Cape Town");
  const E = await makeUser("e", "Durban");
  const M = await makeUser("m", null, "ADMIN");
  for (const u of [A, B, C, D, E, M]) await u.client.login();

  // Empty state: no fake notifications.
  let list = await A.client.json("/api/notifications");
  check("new user starts with zero notifications", list.status === 200 && list.body.items.length === 0 && list.body.unreadCount === 0, list.body);
  check("unauthenticated list is rejected", (await fetch(`${BASE}/api/notifications`)).status === 401);

  // A follows B; searches recorded.
  const follow = await A.client.json(`/api/sellers/${B.user.id}/follow`, { method: "POST" });
  check("A follows B", follow.status === 200 && follow.body.following === true, follow.body);
  check("cannot follow self", (await B.client.json(`/api/sellers/${B.user.id}/follow`, { method: "POST" })).status === 400);
  for (const [c, q] of [[A, "iPhone 14"], [C, "iPhone 14"], [D, "toyota polo"], [E, "toyota polo"]] as const) {
    const r = await c.client.json("/api/search-activity", { method: "POST", body: JSON.stringify({ query: q }) });
    check(`search recorded (${q})`, r.status === 200 && r.body.recorded === true, r.body);
  }

  // B lists an iPhone; nothing is notified until it is approved.
  const created = await B.client.json("/api/listings", {
    method: "POST",
    body: JSON.stringify({ title: "iPhone 14 128GB", description: "Excellent condition, boxed.", priceRand: 9999, categoryId: category.id, condition: "GOOD", location: "Pretoria East", imageUrls: ["/uploads/nc-test.jpg"] }),
  });
  check("B created listing", created.status === 201, created.body);
  const listing1 = created.body.listing as { id: string; slug: string };
  list = await A.client.json("/api/notifications");
  check("no notification while listing is pending review", list.body.items.length === 0, list.body);

  const approve = await M.client.json("/api/admin/moderation", { method: "PATCH", body: JSON.stringify({ targetType: "LISTING", targetId: listing1.id, decision: "APPROVE" }) });
  check("admin approved listing", approve.status === 200, approve.body);

  list = await A.client.json("/api/notifications");
  const aItems = list.body.items as { id: string; type: string; title: string; body: string; link: string; isRead: boolean; imageUrl: string | null }[];
  check("follower A gets exactly one notification", aItems.length === 1, aItems);
  check("A notification is FOLLOWED_SELLER_LISTING", aItems[0]?.type === "FOLLOWED_SELLER_LISTING", aItems[0]);
  check("A title/body name the seller and price", aItems[0]?.title === "New listing from NC B" && aItems[0].body.includes("iPhone 14 128GB") && aItems[0].body.includes("9"), aItems[0]);
  check("A notification links to the listing", aItems[0]?.link === `/listing/${listing1.slug}`, aItems[0]);
  check("A notification carries listing image", aItems[0]?.imageUrl === "/uploads/nc-test.jpg", aItems[0]);
  check("A unread count is 1", list.body.unreadCount === 1, list.body);

  const cList = await C.client.json("/api/notifications");
  check("non-follower C gets SEARCH_MATCH", cList.body.items.length === 1 && cList.body.items[0].type === "SEARCH_MATCH", cList.body);
  check("C (no location) copy does not invent a location", !/near/i.test(cList.body.items[0]?.body ?? "") && cList.body.items[0]?.title === "New match for your recent search", cList.body.items[0]);
  check("C match links to the listing", cList.body.items[0]?.link === `/listing/${listing1.slug}`);
  const bItems = (await B.client.json("/api/notifications")).body.items as { type: string }[];
  check("seller B gets only the approval notice, no follow/search alert for own listing", bItems.every((i) => i.type === "LISTING_APPROVED"), bItems);
  check("E (unrelated search) gets nothing", (await E.client.json("/api/notifications")).body.items.length === 0);

  // Dedupe: re-running fan-out must not create more rows. The shared database can
  // contain real accounts whose recent searches legitimately match this fixture
  // listing, so the exact-row assertion is scoped to fixture users while the
  // no-new-rows assertion covers every recipient.
  const fixtureIds = [A.user.id, B.user.id, C.user.id, D.user.id, E.user.id, M.user.id];
  const before = await prisma.notification.count({ where: { relatedListingId: listing1.id } });
  const fixtureBefore = await prisma.notification.count({ where: { relatedListingId: listing1.id, userId: { in: fixtureIds } } });
  await notifyContentPublished("LISTING", listing1.id);
  await notifyContentPublished("LISTING", listing1.id);
  const after = await prisma.notification.count({ where: { relatedListingId: listing1.id } });
  check("re-running fan-out creates no duplicates", before === after && fixtureBefore === 2, { before, after, fixtureBefore });
  const dup = await createNotifications([{ userId: A.user.id, type: "SEARCH_MATCH", title: "x", body: "x", dedupeKey: `published:listing:${listing1.id}` }]);
  check("direct duplicate insert is ignored by the unique key", dup === 0, dup);

  // Location relevance (local vs not local).
  const created2 = await B.client.json("/api/listings", {
    method: "POST",
    body: JSON.stringify({ title: "Toyota Polo 1.4", description: "Low mileage, full service history.", priceRand: 129000, categoryId: category.id, condition: "GOOD", location: "Cape Town CBD", imageUrls: ["/uploads/nc-test.jpg"] }),
  });
  const listing2 = created2.body.listing as { id: string; slug: string };
  await M.client.json("/api/admin/moderation", { method: "PATCH", body: JSON.stringify({ targetType: "LISTING", targetId: listing2.id, decision: "APPROVE" }) });
  const dList = await D.client.json("/api/notifications");
  check("D (Cape Town) sees a near-you search match", dList.body.items[0]?.type === "SEARCH_MATCH" && /near Cape Town/.test(dList.body.items[0].body), dList.body.items[0]);
  const eList = await E.client.json("/api/notifications");
  check("E (Durban) gets generic copy, no invented location", eList.body.items[0]?.type === "SEARCH_MATCH" && !/near/i.test(eList.body.items[0].body), eList.body.items[0]);

  // Reading.
  list = await A.client.json("/api/notifications");
  check("A now has 2 notifications, newest first", list.body.items.length === 2 && list.body.items[0].link === `/listing/${listing2.slug}`, list.body.items.map((i: { link: string }) => i.link));
  const p1 = await A.client.json("/api/notifications?limit=1");
  check("pagination returns a cursor", p1.body.items.length === 1 && Boolean(p1.body.nextCursor), p1.body);
  const p2 = await A.client.json(`/api/notifications?limit=1&cursor=${p1.body.nextCursor}`);
  check("second page returns the other item and ends", p2.body.items.length === 1 && p2.body.items[0].id !== p1.body.items[0].id && p2.body.nextCursor === null, p2.body);

  const firstId = list.body.items[0].id as string;
  const mark = await A.client.json(`/api/notifications/${firstId}`, { method: "PATCH" });
  check("A marks one notification read", mark.status === 200, mark.body);
  const unreadCount = await A.client.json("/api/notifications/unread-count");
  check("unread count decreases to 1", unreadCount.body.count === 1, unreadCount.body);
  const unreadOnly = await A.client.json("/api/notifications?filter=unread");
  check("unread filter lists only unread", unreadOnly.body.items.length === 1 && unreadOnly.body.items[0].isRead === false, unreadOnly.body);

  // Privacy.
  check("C cannot mark A's notification read", (await C.client.json(`/api/notifications/${firstId}`, { method: "PATCH" })).status === 404);
  check("C cannot delete A's notification", (await C.client.json(`/api/notifications/${firstId}`, { method: "DELETE" })).status === 404);
  check("C cannot page with A's cursor into A's data", (await C.client.json(`/api/notifications?cursor=${firstId}`)).body.items.every((i: { id: string }) => i.id !== firstId));
  check("A's notification still exists after C's attempts", (await prisma.notification.count({ where: { id: firstId } })) === 1);
  check("C mark-all does not touch A", (await C.client.json("/api/notifications/read-all", { method: "POST" })).status === 200 && (await A.client.json("/api/notifications/unread-count")).body.count === 1);

  // Persistence across a fresh login.
  await A.client.login();
  const relogin = await A.client.json("/api/notifications");
  check("notifications persist after logging out and back in", relogin.body.items.length === 2 && relogin.body.unreadCount === 1, relogin.body);

  const all = await A.client.json("/api/notifications/read-all", { method: "POST" });
  check("mark all as read", all.status === 200 && (await A.client.json("/api/notifications/unread-count")).body.count === 0, all.body);

  const del = await A.client.json(`/api/notifications/${firstId}`, { method: "DELETE" });
  check("A can delete own notification", del.status === 200 && (await A.client.json("/api/notifications")).body.items.length === 1, del.body);

  // Price change notifies savers once per price.
  await C.client.json("/api/listings/" + listing1.id + "/favorite", { method: "POST" });
  const edit = await B.client.json(`/api/listings/${listing1.id}`, { method: "PATCH", body: JSON.stringify({ priceRand: 8500 }) });
  check("B edits price", edit.status === 200, edit.body);
  const cAfter = await C.client.json("/api/notifications");
  const price = cAfter.body.items.filter((i: { type: string }) => i.type === "PRICE_CHANGE");
  check("C (saved the listing) gets one PRICE_CHANGE", price.length === 1 && price[0].link === `/listing/${listing1.slug}`, cAfter.body.items);

  // ---- Fake/stale match notification regressions ----

  // Pending-review listings can never produce match notifications.
  const pend = await B.client.json("/api/listings", {
    method: "POST",
    body: JSON.stringify({ title: "iPhone 14 Pending Fixture", description: "Pending fixture item.", priceRand: 100, categoryId: category.id, condition: "GOOD", location: "Pretoria West", imageUrls: ["/uploads/nc-test.jpg"] }),
  });
  check("pending fixture created", pend.status === 201, pend.body);
  const pendId = pend.body.listing.id as string;
  check("pending listing yields no match notifications", (await notifyContentPublished("LISTING", pendId)) === 0 && (await prisma.notification.count({ where: { relatedListingId: pendId } })) === 0);

  // Rejected listings can never produce match notifications.
  await M.client.json("/api/admin/moderation", { method: "PATCH", body: JSON.stringify({ targetType: "LISTING", targetId: pendId, decision: "REJECT" }) });
  check("rejected listing yields no match notifications", (await notifyContentPublished("LISTING", pendId)) === 0 && (await prisma.notification.count({ where: { relatedListingId: pendId } })) === 0);

  // A genuine approved listing that matches a search notifies the right user with
  // an exact reference to the real listing, search and link.
  const live = await B.client.json("/api/listings", {
    method: "POST",
    body: JSON.stringify({ title: "iPhone 14 Live Fixture", description: "Live fixture item.", priceRand: 200, categoryId: category.id, condition: "GOOD", location: "Pretoria East", imageUrls: ["/uploads/nc-test.jpg"] }),
  });
  check("live fixture created", live.status === 201, live.body);
  const liveId = live.body.listing.id as string;
  const liveSlug = live.body.listing.slug as string;
  const approveLive = await M.client.json("/api/admin/moderation", { method: "PATCH", body: JSON.stringify({ targetType: "LISTING", targetId: liveId, decision: "APPROVE" }) });
  check("live fixture approved", approveLive.status === 200, approveLive.body);
  const liveRow = await prisma.notification.findFirst({ where: { userId: C.user.id, relatedListingId: liveId, type: "SEARCH_MATCH" } });
  check("match notification exists for the searching user", Boolean(liveRow), liveRow);
  check("match references the real listing, search and link", liveRow?.link === `/listing/${liveSlug}` && liveRow?.relatedSearchId !== null && (liveRow?.body ?? "").includes("iPhone 14 Live Fixture"), liveRow);
  check("no demo/placeholder copy in match body", !/demo|sample|placeholder|lorem/i.test(liveRow?.body ?? ""), liveRow?.body);

  // Unrelated users must not receive it.
  check("unrelated user D gets no row for this listing", (await prisma.notification.count({ where: { userId: D.user.id, relatedListingId: liveId } })) === 0);
  check("unrelated user E gets no row for this listing", (await prisma.notification.count({ where: { userId: E.user.id, relatedListingId: liveId } })) === 0);
  check("seller gets no search-match for own listing", (await prisma.notification.count({ where: { userId: B.user.id, relatedListingId: liveId, type: "SEARCH_MATCH" } })) === 0);

  // Removing the listing drops the "just listed" promises but keeps event history.
  const removed = await B.client.json(`/api/listings/${liveId}`, { method: "DELETE" });
  check("listing removed", removed.status === 200 && removed.body.removed === true, removed.body);
  check("removal drops search-match rows", (await prisma.notification.count({ where: { relatedListingId: liveId, type: "SEARCH_MATCH" } })) === 0);
  check("follower history row is preserved", (await prisma.notification.count({ where: { relatedListingId: liveId, type: "FOLLOWED_SELLER_LISTING" } })) === 1);
  check("fan-out after removal creates nothing", (await notifyContentPublished("LISTING", liveId)) === 0);

  // Hard-deleted listings yield nothing either.
  await prisma.listing.delete({ where: { id: liveId } });
  check("deleted listing yields no notifications", (await notifyContentPublished("LISTING", liveId)) === 0);

  // Feeds never contain demo/hardcoded sample content.
  const feedC = await C.client.json("/api/notifications");
  const feedA = await A.client.json("/api/notifications");
  const allFeedItems = [...feedC.body.items, ...feedA.body.items] as { title: string; body: string }[];
  check("no demo/sample/placeholder content in feeds", allFeedItems.length > 0 && allFeedItems.every((i) => !/demo|sample|placeholder|lorem/i.test(`${i.title} ${i.body}`)), allFeedItems);

  // ---- Property removal drops "just listed" matches but keeps follower history ----
  const propSearch = await C.client.json("/api/search-activity", { method: "POST", body: JSON.stringify({ query: "penthouse loft" }) });
  check("property search recorded", propSearch.status === 200 && propSearch.body.recorded === true, propSearch.body);
  const propCreated = await B.client.json("/api/properties", {
    method: "POST",
    body: JSON.stringify({ title: "Penthouse Loft Seminary", description: "Spacious loft with a view.", listingType: "FOR_SALE", propertyType: "APARTMENT", priceRand: 2500000, location: "Pretoria East" }),
  });
  check("property fixture created", propCreated.status === 201, propCreated.body);
  const propId = propCreated.body.property.id as string;
  const propSlug = propCreated.body.property.slug as string;
  check("pending property yields no match notifications", (await notifyContentPublished("PROPERTY", propId)) === 0 && (await prisma.notification.count({ where: { relatedPropertyId: propId } })) === 0);
  const approveProp = await M.client.json("/api/admin/moderation", { method: "PATCH", body: JSON.stringify({ targetType: "PROPERTY", targetId: propId, decision: "APPROVE" }) });
  check("property approved", approveProp.status === 200, approveProp.body);
  const propMatch = await prisma.notification.findFirst({ where: { userId: C.user.id, relatedPropertyId: propId, relatedSearchId: { not: null } } });
  check("property search-match delivered with real link", Boolean(propMatch) && propMatch?.link === `/real-estate/${propSlug}` && (propMatch?.body ?? "").includes("Penthouse Loft Seminary"), propMatch);
  check("unrelated user E gets no property match", (await prisma.notification.count({ where: { userId: E.user.id, relatedPropertyId: propId } })) === 0);

  const propRemoved = await B.client.json(`/api/properties/${propId}`, { method: "DELETE" });
  check("property removed", propRemoved.status === 200 && propRemoved.body.removed === true, propRemoved.body);
  check("property removal drops search-match rows", (await prisma.notification.count({ where: { relatedPropertyId: propId, relatedSearchId: { not: null } } })) === 0);
  check("property follower history row is preserved", (await prisma.notification.count({ where: { userId: A.user.id, relatedPropertyId: propId, relatedSearchId: null } })) === 1);
  check("fan-out after property removal creates nothing", (await notifyContentPublished("PROPERTY", propId)) === 0);
}

main()
  .catch((error) => { failures++; console.error(error); })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
    process.exit(failures ? 1 : 0);
  });
