import "dotenv/config";
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

  // Dedupe: re-running fan-out must not create more rows.
  const before = await prisma.notification.count({ where: { relatedListingId: listing1.id } });
  await notifyContentPublished("LISTING", listing1.id);
  await notifyContentPublished("LISTING", listing1.id);
  const after = await prisma.notification.count({ where: { relatedListingId: listing1.id } });
  check("re-running fan-out creates no duplicates", before === after && before === 2, { before, after });
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
}

main()
  .catch((error) => { failures++; console.error(error); })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
    process.exit(failures ? 1 : 0);
  });
