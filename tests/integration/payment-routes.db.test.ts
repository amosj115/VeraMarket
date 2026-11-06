import "../../scripts/test-db-env";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import test, { after, mock } from "node:test";
import { pathToFileURL } from "node:url";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/prisma";
import { BOOST_PRICING_ZAR_CENTS } from "../../src/lib/config";

// Route-level authorisation, ownership and pricing tests against the local *_test database.
// `auth()` is replaced with a controllable session and Peach's HTTP API is replaced with a stub,
// so there is no network access and no real credential involved (all PEACH_* values are dummies).
const run = randomBytes(4).toString("hex");
let session: { user: { id: string; role: string } } | undefined;
mock.module(pathToFileURL(resolve("src/auth.ts")).href, { namedExports: { auth: async () => session } });

Object.assign(process.env, {
  PEACH_ENVIRONMENT: "sandbox",
  PEACH_CLIENT_ID: "test-only-client",
  PEACH_CLIENT_SECRET: "test-only-secret",
  PEACH_MERCHANT_ID: "test-only-merchant",
  PEACH_ENTITY_ID: "test-only-entity",
  PEACH_WEBHOOK_SECRET: "test-only-webhook-secret",
  PEACH_RECURRING_ENTITY_ID: "test-only-recurring-entity",
  PEACH_RECURRING_ACCESS_TOKEN: "test-only-recurring-token",
});

const peachCalls: { url: string; body: Record<string, unknown> }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.includes("peachpayments.com")) return realFetch(input, init);
  if (url.includes("/api/oauth/token")) return Response.json({ access_token: "stub-token", expires_in: 300 });
  peachCalls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
  return Response.json({ checkoutId: `chk_${run}_${peachCalls.length}`, redirectUrl: "https://testsecure.peachpayments.com/stub" });
}) as typeof fetch;

const userIds: string[] = [];
let counter = 0;
async function makeUser(role: "USER" | "ADMIN" = "USER") {
  const n = ++counter;
  const user = await prisma.user.create({ data: { email: `route_${run}_${n}@example.test`, displayName: `Route ${n}`, username: `route_${run}_${n}`, passwordHash: "x", role, emailVerifiedAt: new Date(), profileVerification: "VERIFIED" } });
  userIds.push(user.id);
  return user;
}
const as = (user: { id: string; role: string } | undefined) => { session = user ? { user: { id: user.id, role: user.role } } : undefined; };
const json = (url: string, body: unknown) => new NextRequest(`https://example.test${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

let categoryId: string | undefined;
let createdCategory = false;
async function makeListing(sellerId: string) {
  if (!categoryId) {
    const existing = await prisma.category.findFirst({ where: { domain: "MARKETPLACE" }, select: { id: true } });
    if (existing) categoryId = existing.id;
    else {
      categoryId = (await prisma.category.create({ data: { name: `Route ${run}`, slug: `route-${run}`, domain: "MARKETPLACE", isEnabled: true } })).id;
      createdCategory = true;
    }
  }
  return prisma.listing.create({ data: { sellerId, categoryId, title: `Route listing ${run}`, slug: `route-listing-${run}-${++counter}`, description: "Route test listing", priceCents: 10000, condition: "GOOD", location: "Cape Town", status: "ACTIVE" } });
}
async function makeShop(ownerId: string) {
  return prisma.shop.create({ data: { ownerId, name: `Route Shop ${run} ${++counter}`, slug: `route-shop-${run}-${counter}`, description: "Route test store", address: "Test Road 1", status: "ACTIVE", subscriptionStatus: "PENDING", monthlyPriceCents: 5900 } });
}

after(async () => {
  await prisma.boost.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.shopSubscription.deleteMany({ where: { shop: { ownerId: { in: userIds } } } });
  await prisma.payment.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.shop.deleteMany({ where: { ownerId: { in: userIds } } });
  await prisma.listing.deleteMany({ where: { sellerId: { in: userIds } } });
  if (createdCategory && categoryId) await prisma.category.delete({ where: { id: categoryId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

const boostsRoute = () => import("../../src/app/api/boosts/route");
const subscriptionRoute = () => import("../../src/app/api/shops/[id]/subscription/route");
const params = (id: string) => ({ params: Promise.resolve({ id }) });

test("boosts route: unauthenticated request is rejected and creates nothing", async () => {
  as(undefined);
  const targetId = "c".repeat(25);
  const { POST } = await boostsRoute();
  const response = await POST(json("/api/boosts", { targetType: "LISTING", targetId, duration: "SEVEN_DAYS" }));
  assert.equal(response.status, 401);
  assert.equal(await prisma.boost.count({ where: { listingId: targetId } }), 0);
});

test("boosts route: cannot buy a boost for another seller's listing", async () => {
  const owner = await makeUser();
  const attacker = await makeUser();
  const listing = await makeListing(owner.id);
  as(attacker);
  const { POST } = await boostsRoute();
  const response = await POST(json("/api/boosts", { targetType: "LISTING", targetId: listing.id, duration: "SEVEN_DAYS" }));
  assert.equal(response.status, 403);
  assert.equal(await prisma.boost.count({ where: { userId: attacker.id } }), 0);
  assert.equal(await prisma.payment.count({ where: { userId: attacker.id } }), 0);
});

test("boosts route: price comes from server config, a client-supplied amount is ignored, and the boost stays unpaid", async () => {
  const seller = await makeUser();
  const listing = await makeListing(seller.id);
  as(seller);
  const { POST } = await boostsRoute();
  const calls = peachCalls.length;
  const response = await POST(json("/api/boosts", { targetType: "LISTING", targetId: listing.id, duration: "SEVEN_DAYS", amountCents: 1, priceCents: 1, amount: 0.01 }));
  assert.equal(response.status, 201);
  const boost = await prisma.boost.findFirstOrThrow({ where: { userId: seller.id }, include: { payment: true } });
  assert.equal(boost.payment?.amountCents, BOOST_PRICING_ZAR_CENTS.SEVEN_DAYS);
  assert.equal(boost.payment?.status, "PENDING");
  assert.equal(boost.status, "PENDING_PAYMENT");
  assert.equal(boost.startsAt, null);
  const sent = peachCalls[calls]?.body;
  assert.equal(sent?.amount, BOOST_PRICING_ZAR_CENTS.SEVEN_DAYS / 100);
  assert.equal(sent?.createRegistration, undefined, "boosts must never tokenise or recur");
  assert.equal(sent?.standingInstruction, undefined);
});

test("boosts route: an inactive listing cannot be boosted", async () => {
  const seller = await makeUser();
  const listing = await makeListing(seller.id);
  await prisma.listing.update({ where: { id: listing.id }, data: { status: "PENDING_REVIEW" } });
  as(seller);
  const { POST } = await boostsRoute();
  const response = await POST(json("/api/boosts", { targetType: "LISTING", targetId: listing.id, duration: "ONE_DAY" }));
  assert.equal(response.status, 409);
  assert.equal(await prisma.payment.count({ where: { userId: seller.id } }), 0);
});

test("subscription route: unauthenticated request is rejected", async () => {
  as(undefined);
  const owner = await makeUser();
  const shop = await makeShop(owner.id);
  const { POST } = await subscriptionRoute();
  const response = await POST(json(`/api/shops/${shop.id}/subscription`, { action: "subscribe", autoRenewConsent: true }), params(shop.id));
  assert.equal(response.status, 401);
});

test("subscription route: another seller cannot subscribe, cancel or pause someone else's store", async () => {
  const owner = await makeUser();
  const attacker = await makeUser();
  const shop = await makeShop(owner.id);
  const sub = await prisma.shopSubscription.create({ data: { shopId: shop.id, status: "ACTIVE", monthlyPriceCents: 5900, provider: "peach", startsAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000), autoRenew: true } });
  as(attacker);
  const { POST } = await subscriptionRoute();
  for (const action of ["subscribe", "cancel", "pause", "reactivate"]) {
    const response = await POST(json(`/api/shops/${shop.id}/subscription`, { action, autoRenewConsent: true }), params(shop.id));
    assert.equal(response.status, 404, action);
  }
  const after = await prisma.shopSubscription.findUniqueOrThrow({ where: { id: sub.id } });
  assert.equal(after.autoRenew, true);
  assert.equal(after.cancelledAt, null);
  assert.equal((await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } })).isPaused, false);
  assert.equal(await prisma.payment.count({ where: { userId: attacker.id } }), 0);
});

test("subscription route: starting a subscription needs explicit auto-renew consent", async () => {
  const owner = await makeUser();
  const shop = await makeShop(owner.id);
  as(owner);
  const { POST } = await subscriptionRoute();
  for (const consent of [undefined, false, "true", 1]) {
    const response = await POST(json(`/api/shops/${shop.id}/subscription`, { action: "subscribe", autoRenewConsent: consent }), params(shop.id));
    assert.equal(response.status, 400);
  }
  assert.equal(await prisma.payment.count({ where: { userId: owner.id } }), 0);
});

test("subscription route: price is the server-side shop price, checkout is recurring, and a second start is blocked", async () => {
  const owner = await makeUser();
  const shop = await makeShop(owner.id);
  as(owner);
  const { POST } = await subscriptionRoute();
  const calls = peachCalls.length;
  const response = await POST(json(`/api/shops/${shop.id}/subscription`, { action: "subscribe", autoRenewConsent: true, amountCents: 1, monthlyPriceCents: 1 }), params(shop.id));
  assert.equal(response.status, 201);
  const payment = await prisma.payment.findFirstOrThrow({ where: { userId: owner.id } });
  assert.equal(payment.amountCents, 5900);
  assert.equal(payment.kind, "INITIAL");
  assert.equal(payment.status, "PENDING");
  const sub = await prisma.shopSubscription.findUniqueOrThrow({ where: { shopId: shop.id } });
  assert.equal(sub.status, "PENDING", "unpaid subscription must not be active");
  assert.equal(sub.autoRenew, false, "auto-renew only after a verified, tokenised payment");
  assert.equal(sub.providerToken, null);
  const sent = peachCalls[calls]?.body;
  assert.equal(sent?.amount, 59);
  assert.equal(sent?.createRegistration, true);

  const again = await POST(json(`/api/shops/${shop.id}/subscription`, { action: "subscribe", autoRenewConsent: true }), params(shop.id));
  assert.equal(again.status, 409);
  assert.equal(await prisma.payment.count({ where: { userId: owner.id } }), 1);
});

test("admin payments page: unauthenticated and non-admin users are redirected, admin can view", async () => {
  const { default: AdminPaymentsPage } = await import("../../src/app/admin/payments/page");
  const redirected = async () => {
    try {
      await AdminPaymentsPage();
    } catch (error) {
      return String((error as { digest?: string }).digest ?? "").startsWith("NEXT_REDIRECT");
    }
    return false;
  };
  as(undefined);
  assert.equal(await redirected(), true);
  as(await makeUser("USER"));
  assert.equal(await redirected(), true);
  as(await makeUser("ADMIN"));
  assert.equal(await redirected(), false);
});
