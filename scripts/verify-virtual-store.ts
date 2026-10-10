import "dotenv/config";
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/security/password";

// Virtual Store subscription (R59/month) + 25/50/100% visibility boost verification.
// Run a production server first:  $env:AUTH_TRUST_HOST="true"; npm run start -- -p 3100
// then:  npx tsx scripts/verify-virtual-store.ts   (VERIFY_BASE=http://localhost:3100)

const BASE = process.env.VERIFY_BASE ?? "http://localhost:3100";
const WEBHOOK_URL = `${BASE}/api/payments/paystack/webhook`;
const prisma = new PrismaClient();
const run = Date.now().toString(36);
const PASSWORD = "Passw0rdTest1";
let failures = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` -> ${JSON.stringify(detail)}`}`);
}
function scenario(label: string) {
  console.log(`\n--- ${label}`);
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
    return fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", Cookie: this.header() }, ...(init.headers ?? {}) });
  }
  async json(path: string, init: RequestInit = {}) {
    const res = await this.req(path, init);
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  async text(path: string) {
    const res = await this.req(path);
    return { status: res.status, text: await res.text() };
  }
}

type User = { id: string; email: string };
const created: User[] = [];

async function makeUser(tag: string): Promise<{ user: User; client: Client }> {
  const email = `vs-test-${run}-${tag}@example.test`;
  const user = await prisma.user.create({
    data: { email, displayName: `VS Test ${tag.toUpperCase()}`, username: `vst_${run}_${tag}`, passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date(), profileVerification: "VERIFIED" },
  });
  created.push({ id: user.id, email });
  return { user, client: new Client(email) };
}

async function webhook(reference: string, signatureBody: string, signature: string) {
  return fetch(WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json", "x-paystack-signature": signature }, body: signatureBody });
}
const sign = (body: string) => createHmac("sha512", process.env.PAYSTACK_WEBHOOK_SECRET ?? "").update(body).digest("hex");

const DAY = 24 * 60 * 60 * 1000;

async function main() {
  if (!process.env.PAYSTACK_WEBHOOK_SECRET) throw new Error("PAYSTACK_WEBHOOK_SECRET missing - webhook cannot be verified");
  const category = await prisma.category.findFirst({ where: { domain: "MARKETPLACE", isEnabled: true }, orderBy: { sortOrder: "asc" }, select: { id: true } });
  if (!category) throw new Error("no marketplace category in database");

  // --- Seed: 4 sellers. A owns the store (and the store-baseline + combined listings).
  const A = await makeUser("owner");
  const C = await makeUser("boost100");
  const D = await makeUser("boostdur");
  const E = await makeUser("organic");
  const clientA = A.client;
  await clientA.login();
  await C.client.login();
  await E.client.login();

  const shopA = await prisma.shop.create({
    data: { ownerId: A.user.id, name: `VS Test Store ${run}`, slug: `vs-test-store-${run}`, description: "Test storefront for subscription verification.", address: "Test Road 1", status: "ACTIVE", subscriptionStatus: "PENDING", monthlyPriceCents: 5900 },
  });
  const mkListing = (sellerId: string, title: string) =>
    prisma.listing.create({ data: { sellerId, categoryId: category.id, title, slug: `${title.toLowerCase().replace(/\s+/g, "-")}-${run}`, description: "Test listing for virtual store verification.", priceCents: 100000, condition: "NEW", location: "Cape Town", status: "ACTIVE" } });
  const Lstore = await mkListing(A.user.id, `VS Store Item ${run}`);
  const L50 = await mkListing(A.user.id, `VS Combined Boost ${run}`);
  const L100 = await mkListing(C.user.id, `VS Hundred Boost ${run}`);
  const Ldur = await mkListing(D.user.id, `VS Duration Boost ${run}`);
  const Lorg = await mkListing(E.user.id, `VS Organic Item ${run}`);
  const boostRow = (userId: string, listingId: string, priority: number) =>
    prisma.boost.create({ data: { userId, targetType: "LISTING", duration: "SEVEN_DAYS", status: "ACTIVE", startsAt: new Date(), expiresAt: new Date(Date.now() + 7 * DAY), priority, listingId } });
  await boostRow(C.user.id, L100.id, 100);
  await boostRow(A.user.id, L50.id, 50);
  await boostRow(D.user.id, Ldur.id, 1);

  const shopVisible = async () => {
    const data = await (await fetch(`${BASE}/api/shops`)).json();
    return (data?.shops ?? []).some((s: { id: string }) => s.id === shopA.id);
  };
  const badgeOn = async () => (await clientA.text(`/listing/${Lstore.slug}`)).text.includes("Available in Virtual Store");
  const listRow = async (id: string) => {
    const data = await (await fetch(`${BASE}/api/listings?page=1`)).json();
    return (data?.listings ?? []).find((l: { id: string }) => l.id === id) ?? null;
  };

  scenario("S1: R59 price is visible before any payment");
  const dash = await clientA.text("/profile/shops");
  check("dashboard shows the R59 price", /R\s*59/.test(dash.text.replace(/<[^>]+>/g, " ")), "price not found on /profile/shops");
  check("dashboard shows the subscribe button", dash.text.includes("Subscribe for"), "no subscribe button");
  check("dashboard explains the 25% baseline boost", dash.text.includes("25% visibility boost"), "no boost explainer");

  scenario("S2: subscribe access control");
  const anon = await fetch(`${BASE}/api/shops/${shopA.id}/subscription`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "subscribe" }) });
  check("anonymous subscribe is rejected (401)", anon.status === 401, anon.status);
  const foreign = await C.client.json(`/api/shops/${shopA.id}/subscription`, { method: "POST", body: JSON.stringify({ action: "subscribe" }) });
  check("foreign shop subscribe is rejected (404)", foreign.status === 404, foreign.status);

  scenario("S3: subscribe never fakes a payment or activation");
  check("store is not public before payment", !(await shopVisible()));
  check("listing has no store badge before payment", !(await badgeOn()));
  const prePay = await listRow(Lstore.id);
  check("no 25% baseline before payment", prePay?.visibilityWeight === 0 && prePay?.store === null, prePay);
  const paymentsBefore = await prisma.payment.count({ where: { userId: A.user.id } });
  const subRes = await clientA.json(`/api/shops/${shopA.id}/subscription`, { method: "POST", body: JSON.stringify({ action: "subscribe" }) });
  if (subRes.status === 201) {
    check("Paystack checkout started (201 + authorizationUrl)", Boolean(subRes.body?.authorizationUrl), subRes);
  } else {
    // This environment has no Paystack credentials, so the route must refuse to
    // take money at all (503) or fail initialization cleanly (502) - never fake it.
    check(`blocked before payment in this environment (${subRes.status})`, subRes.status === 503 || subRes.status === 502, subRes.body);
    check("config refusal names the missing credentials", subRes.status !== 503 || Array.isArray(subRes.body?.missing) && subRes.body.missing.length > 0, subRes.body);
    check("no payment row was created", (await prisma.payment.count({ where: { userId: A.user.id } })) === paymentsBefore);
  }
  check("charged amount is exactly R59 (5900 cents) when checkout starts", subRes.status !== 201 || subRes.body?.amountCents === 5900, subRes.body);
  let shopRow = await prisma.shop.findUnique({ where: { id: shopA.id }, include: { subscription: true } });
  check("no activation notification before webhook", (await prisma.notification.count({ where: { userId: A.user.id, type: "STORE_SUBSCRIPTION_ACTIVE" } })) === 0);
  check("shop not marked ACTIVE before webhook", shopRow?.subscriptionStatus !== "ACTIVE", shopRow?.subscriptionStatus);
  check("store not public before webhook", !(await shopVisible()));

  // If Paystack could not take the payment here, inject the exact pending rows the
  // route creates after a successful initialize so the webhook path stays testable.
  let payment = shopRow?.subscription?.paymentId ? await prisma.payment.findUnique({ where: { id: shopRow.subscription.paymentId } }) : null;
  let subId = shopRow?.subscription?.id ?? null;
  if (!payment || !subId) {
    console.log("NOTE: Paystack checkout unavailable in this environment - injecting pending payment + subscription to exercise webhook activation.");
    payment = await prisma.payment.create({ data: { userId: A.user.id, purpose: "VIRTUAL_STORE_SUBSCRIPTION", amountCents: 5900, currency: "ZAR", status: "PENDING", provider: "paystack", providerRef: `vera_injected_${run}` } });
    const sub = await prisma.shopSubscription.upsert({ where: { shopId: shopA.id }, update: { status: "PENDING", monthlyPriceCents: 5900, paymentId: payment.id }, create: { shopId: shopA.id, status: "PENDING", monthlyPriceCents: 5900, paymentId: payment.id } });
    subId = sub.id;
    shopRow = await prisma.shop.findUnique({ where: { id: shopA.id }, include: { subscription: true } });
    check("injected subscription starts PENDING", sub.status === "PENDING", sub.status);
  }

  scenario("S4: webhook signature is enforced");
  if (payment && subId) {
    const goodBody = JSON.stringify({ event: "charge.success", data: { reference: payment.providerRef, status: "success" } });
    const bad = await webhook(payment.providerRef, goodBody, "not-a-real-signature");
    check("invalid signature rejected (401)", bad.status === 401, bad.status);
    check("payment untouched after bad signature", (await prisma.payment.findUnique({ where: { id: payment.id } }))?.status === "PENDING");

    scenario("S5: charge.success activates the R59 subscription");
    const ok = await webhook(payment.providerRef, goodBody, sign(goodBody));
    check("webhook accepted (200)", ok.status === 200, ok.status);
    const after = await prisma.payment.findUnique({ where: { id: payment.id } });
    const subAfter = await prisma.shopSubscription.findUnique({ where: { id: subId } });
    const shopAfter = await prisma.shop.findUnique({ where: { id: shopA.id } });
    check("payment SUCCEEDED with verifiedAt", after?.status === "SUCCEEDED" && Boolean(after?.verifiedAt), after?.status);
    const lifetime = subAfter?.expiresAt ? subAfter.expiresAt.getTime() - Date.now() : 0;
    check("subscription ACTIVE for ~30 days", subAfter?.status === "ACTIVE" && lifetime > 29 * DAY && lifetime < 31 * DAY, subAfter);
    check("renewsAt mirrors expiry", subAfter?.renewsAt?.getTime() === subAfter?.expiresAt?.getTime(), subAfter);
    check("shop.subscriptionStatus ACTIVE", shopAfter?.subscriptionStatus === "ACTIVE", shopAfter?.subscriptionStatus);
    check("activation notification created", (await prisma.notification.count({ where: { userId: A.user.id, type: "STORE_SUBSCRIPTION_ACTIVE" } })) === 1);
    check("store is now public", await shopVisible());
    check("listing page shows the badge + Visit Store", (await badgeOn()) && (await clientA.text(`/listing/${Lstore.slug}`)).text.includes(`/shops/${shopA.slug}`));
    const weighted = await listRow(Lstore.id);
    check("store listing now has 25% baseline weight", weighted?.visibilityWeight === 25 && weighted?.store?.slug === shopA.slug, weighted);

    scenario("S6: webhook replay is idempotent");
    const expiresBefore = subAfter?.expiresAt?.getTime();
    await webhook(payment.providerRef, goodBody, sign(goodBody));
    const subReplay = await prisma.shopSubscription.findUnique({ where: { id: subId } });
    check("replay does not extend the period", subReplay?.expiresAt?.getTime() === expiresBefore, { was: expiresBefore, now: subReplay?.expiresAt?.getTime() });
    check("replay does not duplicate the notification", (await prisma.notification.count({ where: { userId: A.user.id, type: "STORE_SUBSCRIPTION_ACTIVE" } })) === 1);
  } else {
    check("webhook scenarios skipped - no payment/subscription row (Paystack initialize failed?)", false, { payment: Boolean(payment), subId });
  }

  scenario("S7: renewal guard - active subscription cannot be re-charged early");
  const renewPayments = await prisma.payment.count({ where: { userId: A.user.id } });
  const renew = await clientA.json(`/api/shops/${shopA.id}/subscription`, { method: "POST", body: JSON.stringify({ action: "subscribe" }) });
  check("re-subscribe blocked while active (400)", renew.status === 400 && String(renew.body?.error ?? "").includes("already active"), renew);
  check("blocked renewal created no payment", (await prisma.payment.count({ where: { userId: A.user.id } })) === renewPayments);

  scenario("S8: marketplace placement order 100 > 50 > 25 > 1 > organic");
  const listRes = await (await fetch(`${BASE}/api/listings?page=1`)).json();
  const order: string[] = (listRes.listings ?? []).map((l: { id: string }) => l.id);
  const pos = (id: string) => order.indexOf(id);
  check("all five test listings on page 1", [L100.id, L50.id, Lstore.id, Ldur.id, Lorg.id].every((id) => pos(id) >= 0), order.slice(0, 20));
  check("100% boost ranks above 50% boost", pos(L100.id) < pos(L50.id), { p100: pos(L100.id), p50: pos(L50.id) });
  check("50% boost ranks above 25% store baseline", pos(L50.id) < pos(Lstore.id));
  check("store baseline ranks above duration boost (priority 1)", pos(Lstore.id) < pos(Ldur.id));
  check("duration boost ranks above organic", pos(Ldur.id) < pos(Lorg.id));
  const row = (id: string) => listRes.listings.find((l: { id: string }) => l.id === id);
  check("weights are 100/50/25/1/0", row(L100.id)?.visibilityWeight === 100 && row(L50.id)?.visibilityWeight === 50 && row(Lstore.id)?.visibilityWeight === 25 && row(Ldur.id)?.visibilityWeight === 1 && row(Lorg.id)?.visibilityWeight === 0, [row(L100.id)?.visibilityWeight, row(L50.id)?.visibilityWeight, row(Lstore.id)?.visibilityWeight, row(Ldur.id)?.visibilityWeight, row(Lorg.id)?.visibilityWeight]);
  check("boosted flag only for paid boosts", row(L100.id)?.boosted === true && row(Ldur.id)?.boosted === true && row(Lstore.id)?.boosted === false && row(Lorg.id)?.boosted === false);
  check("store field present exactly for store listings", row(Lstore.id)?.store?.name === shopA.name && row(Lorg.id)?.store === null && row(L100.id)?.store === null);

  scenario("S9: combination rule - boosts do not stack");
  check("store + 50% boost = 50, not 75", row(L50.id)?.visibilityWeight === 50, row(L50.id)?.visibilityWeight);

  scenario("S10: unpriced 50/100 boosts cannot be sold");
  await clientA.text("/profile/boosts"); // seeds packages via listBoostPackages
  const p50 = await prisma.boostPackage.findUnique({ where: { key: "boost-visibility-50" } });
  const p100 = await prisma.boostPackage.findUnique({ where: { key: "boost-visibility-100" } });
  check("50% package seeded with priority 50", p50?.priority === 50 && p50?.durationDays === 7, p50);
  check("100% package seeded with priority 100", p100?.priority === 100 && p100?.durationDays === 7, p100);
  const testPkg = await prisma.boostPackage.create({ data: { key: `vs-unpriced-${run}`, name: "VS Test Unpriced Boost", description: "Must never be sellable at zero price.", priceCents: 0, durationDays: 7, priority: 60, enabled: true } });
  const boostsBefore = await prisma.boost.count({ where: { userId: A.user.id } });
  const buy = await clientA.json("/api/boosts", { method: "POST", body: JSON.stringify({ targetType: "LISTING", targetId: Lstore.id, packageId: testPkg.id }) });
  check("zero-price package purchase rejected (400 price guard, or 503 if payment config also missing)", buy.status === 400 ? String(buy.body?.error ?? "").toLowerCase().includes("price") : buy.status === 503, buy);
  check("rejected purchase created no boost", (await prisma.boost.count({ where: { userId: A.user.id } })) === boostsBefore);
  const buyPage = await clientA.text("/profile/boosts");
  check("unpriced packages are hidden from the buy UI", !buyPage.text.includes("VS Test Unpriced Boost") && (p50?.priceCents === 0 ? !buyPage.text.includes("50% Visibility Boost") : true));

  scenario("S11: expiry stops benefits immediately (read-time gate)");
  if (subId) {
    await prisma.shopSubscription.update({ where: { id: subId }, data: { expiresAt: new Date(Date.now() - 60 * 1000) } });
    check("expired store removed from public list", !(await shopVisible()));
    check("badge gone immediately", !(await badgeOn()));
    const expiredRow = await listRow(Lstore.id);
    check("25% baseline gone immediately", expiredRow?.visibilityWeight === 0 && expiredRow?.store === null, expiredRow);

    scenario("S12: expiry cron flips status and notifies the owner");
    const cron = await fetch(`${BASE}/api/shops/expire`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    check("cron accepted with bearer secret", cron.status === 200, cron.status);
    const cronBody = await cron.json();
    check("cron reports one expired subscription", cronBody.expired >= 1, cronBody);
    const subCron = await prisma.shopSubscription.findUnique({ where: { id: subId } });
    const shopCron = await prisma.shop.findUnique({ where: { id: shopA.id } });
    check("subscription status EXPIRED", subCron?.status === "EXPIRED", subCron?.status);
    check("shop.subscriptionStatus EXPIRED", shopCron?.subscriptionStatus === "EXPIRED", shopCron?.subscriptionStatus);
    check("expiry notification sent", (await prisma.notification.count({ where: { userId: A.user.id, type: "SHOP_UPDATE", title: { contains: "expired" } } })) >= 1);
    const badSecret = await fetch(`${BASE}/api/shops/expire`, { headers: { Authorization: "Bearer wrong" } });
    check("cron rejects wrong secret", badSecret.status === 401, badSecret.status);
  } else {
    check("expiry scenarios skipped (no subscription row)", false, subId);
  }

  scenario("S13: pause hides the store but never cancels the paid subscription");
  if (subId) {
    await prisma.shopSubscription.update({ where: { id: subId }, data: { status: "ACTIVE", expiresAt: new Date(Date.now() + 20 * DAY) } });
    await prisma.shop.update({ where: { id: shopA.id }, data: { subscriptionStatus: "ACTIVE" } });
    check("restored store is public", await shopVisible());
    const pause = await clientA.json(`/api/shops/${shopA.id}/subscription`, { method: "POST", body: JSON.stringify({ action: "pause" }) });
    check("pause accepted", pause.status === 200 && pause.body?.paused === true, pause);
    const pausedShop = await prisma.shop.findUnique({ where: { id: shopA.id }, include: { subscription: true } });
    check("pause does not cancel the subscription", pausedShop?.isPaused === true && pausedShop?.subscriptionStatus === "ACTIVE" && pausedShop?.subscription?.status === "ACTIVE", { isPaused: pausedShop?.isPaused, shopStatus: pausedShop?.subscriptionStatus, subStatus: pausedShop?.subscription?.status });
    check("paused store is hidden", !(await shopVisible()));
    const resume = await clientA.json(`/api/shops/${shopA.id}/subscription`, { method: "POST", body: JSON.stringify({ action: "reactivate" }) });
    check("reactivate restores visibility", resume.status === 200 && (await shopVisible()), resume);
    check("badge is back after reactivate", await badgeOn());
  }
}

async function cleanup() {
  const ids = created.map((u) => u.id);
  const shops = await prisma.shop.findMany({ where: { ownerId: { in: ids } }, select: { id: true } });
  await prisma.shop.deleteMany({ where: { id: { in: shops.map((s) => s.id) } } }).catch(() => null);
  await prisma.payment.deleteMany({ where: { userId: { in: ids } } }).catch(() => null);
  await prisma.boost.deleteMany({ where: { userId: { in: ids } } }).catch(() => null);
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } }).catch(() => null);
  await prisma.listing.deleteMany({ where: { sellerId: { in: ids } } }).catch(() => null);
  await prisma.boostPackage.deleteMany({ where: { key: { startsWith: "vs-unpriced-" } } }).catch(() => null);
  await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => null);
}

main()
  .catch((error) => { failures++; console.error("SCRIPT ERROR", error); })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  });
