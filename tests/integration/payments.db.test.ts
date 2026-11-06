import "../../scripts/test-db-env";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import test, { after } from "node:test";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/prisma";
import { secureAppUrl } from "../../src/lib/app-url";
import { peachProvider, peachWebhookUrl } from "../../src/lib/payments/peach";
import type { PaymentProvider, VerifiedPayment } from "../../src/lib/payments/provider";
import { MAX_RENEWAL_ATTEMPTS, applyVerifiedPayment, cancelShopSubscription, newPaymentRef, processDueRenewals } from "../../src/lib/payments/service";
import { subscriptionState } from "../../src/lib/shops";
import { POST as webhookPOST } from "../../src/app/api/payments/peach/webhook/route";
import { GET as returnGET } from "../../src/app/api/payments/return/route";
import { GET as renewalsGET } from "../../src/app/api/payments/renewals/route";

// Real-database tests (local *_test database only, enforced by scripts/test-db-env). No network:
// the Peach status/charge calls are replaced with stubs and dummy, non-secret env values.
const DAY = 24 * 60 * 60 * 1000;
const run = randomBytes(4).toString("hex");
const WEBHOOK_SECRET = "test-only-webhook-secret";
process.env.PEACH_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.PEACH_RECURRING_ENTITY_ID = "test-only-entity";
process.env.PEACH_RECURRING_ACCESS_TOKEN = "test-only-token";
process.env.CRON_SECRET = "test-only-cron-secret";

const userIds: string[] = [];
let counter = 0;

async function makeUser() {
  const n = ++counter;
  const user = await prisma.user.create({ data: { email: `pay_${run}_${n}@example.test`, displayName: `Pay ${n}`, username: `pay_${run}_${n}`, passwordHash: "x", emailVerifiedAt: new Date(), profileVerification: "VERIFIED" } });
  userIds.push(user.id);
  return user;
}

async function boostFixture(opts: { amountCents?: number; checkoutId?: string } = {}) {
  const user = await makeUser();
  const ref = newPaymentRef();
  const boost = await prisma.boost.create({ data: { user: { connect: { id: user.id } }, targetType: "LISTING", duration: "SEVEN_DAYS", durationDays: 7, status: "PENDING_PAYMENT", priority: 100, payment: { create: { user: { connect: { id: user.id } }, purpose: "BOOST", amountCents: opts.amountCents ?? 4900, currency: "ZAR", provider: "peach", providerRef: ref, status: "PENDING", providerCheckoutId: opts.checkoutId ?? `chk_${ref}` } } }, include: { payment: true } });
  return { user, boost, payment: boost.payment!, ref };
}

async function shopFixture(opts: { sub?: { status: "PENDING" | "ACTIVE" | "EXPIRED"; expiresAt?: Date; autoRenew?: boolean; token?: string } } = {}) {
  const user = await makeUser();
  const shop = await prisma.shop.create({ data: { ownerId: user.id, name: `Pay Shop ${run} ${counter}`, slug: `pay-shop-${run}-${counter}`, description: "Payment test store", address: "Test Road 1", status: "ACTIVE", subscriptionStatus: "PENDING", monthlyPriceCents: 5900 } });
  const s = opts.sub;
  const subscription = await prisma.shopSubscription.create({ data: { shopId: shop.id, status: s?.status ?? "PENDING", monthlyPriceCents: 5900, provider: "peach", ...(s ? { startsAt: new Date(), expiresAt: s.expiresAt ?? null, renewsAt: s.expiresAt ?? null, autoRenew: s.autoRenew ?? false, providerToken: s.token ?? null, providerInitialTxId: s.token ? "init_tx" : null } : {}) } });
  return { user, shop, subscription };
}

async function initialSubPayment(subscriptionId: string, userId: string, amountCents = 5900) {
  const ref = newPaymentRef();
  return prisma.payment.create({ data: { userId, purpose: "VIRTUAL_STORE_SUBSCRIPTION", amountCents, currency: "ZAR", provider: "peach", providerRef: ref, status: "PENDING", kind: "INITIAL", subscriptionId, providerCheckoutId: `chk_${ref}` } });
}

const verified = (p: { providerRef: string; providerCheckoutId?: string | null; amountCents: number }, over: Partial<VerifiedPayment> = {}): VerifiedPayment => ({ providerRef: p.providerRef, checkoutId: p.providerCheckoutId ?? undefined, state: "SUCCEEDED", amountCents: p.amountCents, currency: "ZAR", providerPaymentId: `pay_${p.providerRef}`, ...over });

type ChargeInput = Parameters<PaymentProvider["chargeStoredToken"]>[0];
function fakeProvider(charge: (input: ChargeInput) => Promise<VerifiedPayment>): PaymentProvider & { charges: number; tokens: string[] } {
  const provider = { ...peachProvider, id: "peach", supportsRecurring: true, charges: 0, tokens: [] as string[], chargeStoredToken: async (input: ChargeInput) => { provider.charges++; provider.tokens.push(input.token); return charge(input); } };
  return provider as unknown as PaymentProvider & { charges: number; tokens: string[] };
}
const chargeResult = (state: VerifiedPayment["state"]) => async (input: ChargeInput): Promise<VerifiedPayment> => ({ providerRef: input.providerRef, state, amountCents: input.amountCents, currency: "ZAR", providerPaymentId: `mit_${input.providerRef}`, reason: state === "FAILED" ? "800.100.151" : undefined });

after(async () => {
  const payments = await prisma.payment.findMany({ where: { userId: { in: userIds } }, select: { providerRef: true } });
  await prisma.paymentWebhookEvent.deleteMany({ where: { providerRef: { in: payments.map((p) => p.providerRef) } } });
  await prisma.paymentWebhookEvent.deleteMany({ where: { eventId: { startsWith: `evt_${run}` } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.boost.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.shopSubscription.deleteMany({ where: { shop: { ownerId: { in: userIds } } } });
  await prisma.payment.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.shop.deleteMany({ where: { ownerId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

// ---------- Boosts ----------

test("boost: verified success activates once and records payment, price, duration and timestamps", async () => {
  const f = await boostFixture();
  const now = new Date("2026-05-01T10:00:00Z");
  assert.equal(await applyVerifiedPayment("peach", verified(f.payment), { now, webhookEventId: `evt_${run}_b1` }), "activated");
  const boost = await prisma.boost.findUniqueOrThrow({ where: { id: f.boost.id } });
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } });
  assert.equal(boost.status, "ACTIVE");
  assert.equal(boost.startsAt?.getTime(), now.getTime());
  assert.equal(boost.expiresAt?.getTime(), now.getTime() + 7 * DAY);
  assert.equal(boost.paymentId, payment.id);
  assert.equal(payment.status, "SUCCEEDED");
  assert.equal(payment.amountCents, 4900);
  assert.equal(payment.currency, "ZAR");
  assert.equal(payment.providerRef, f.ref);
  assert.equal(payment.provider, "peach");
  assert.ok(payment.verifiedAt);
});

test("boost: pending, failed and cancelled payments never activate it", async () => {
  for (const state of ["PENDING", "FAILED", "CANCELLED"] as const) {
    const f = await boostFixture();
    await applyVerifiedPayment("peach", verified(f.payment, { state }), { webhookEventId: `evt_${run}_${state}_${f.ref}` });
    const boost = await prisma.boost.findUniqueOrThrow({ where: { id: f.boost.id } });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } });
    assert.notEqual(boost.status, "ACTIVE", state);
    assert.equal(boost.startsAt, null, state);
    assert.equal(boost.expiresAt, null, state);
    assert.equal(payment.status, state, state);
  }
});

test("boost: a payment that only exists as an unverified record (no provider confirmation) stays inactive", async () => {
  const f = await boostFixture();
  const boost = await prisma.boost.findUniqueOrThrow({ where: { id: f.boost.id } });
  assert.equal(boost.status, "PENDING_PAYMENT");
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } })).verifiedAt, null);
});

test("boost: duplicate webhook delivery and replays cannot activate or extend it twice", async () => {
  const f = await boostFixture();
  const first = new Date("2026-05-01T10:00:00Z");
  assert.equal(await applyVerifiedPayment("peach", verified(f.payment), { now: first, webhookEventId: `evt_${run}_dup` }), "activated");
  assert.equal(await applyVerifiedPayment("peach", verified(f.payment), { now: new Date(first.getTime() + DAY), webhookEventId: `evt_${run}_dup` }), "duplicate_event");
  assert.equal(await applyVerifiedPayment("peach", verified(f.payment), { now: new Date(first.getTime() + 2 * DAY), webhookEventId: `evt_${run}_dup2` }), "already_processed");
  const boost = await prisma.boost.findUniqueOrThrow({ where: { id: f.boost.id } });
  assert.equal(boost.expiresAt?.getTime(), first.getTime() + 7 * DAY);
  assert.equal(await prisma.notification.count({ where: { userId: f.user.id, type: "BOOST_ACTIVATED" } }), 1);
});

test("boost: concurrent deliveries activate exactly once", async () => {
  const f = await boostFixture();
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => applyVerifiedPayment("peach", verified(f.payment), { webhookEventId: `evt_${run}_race${i}_${f.ref}` })));
  assert.equal(results.filter((r) => r === "activated").length, 1, JSON.stringify(results));
  assert.equal(await prisma.notification.count({ where: { userId: f.user.id, type: "BOOST_ACTIVATED" } }), 1);
});

test("boost: amount, currency and checkout mismatches and unknown or foreign references never activate", async () => {
  const cases: Array<[string, (p: Awaited<ReturnType<typeof boostFixture>>["payment"]) => VerifiedPayment]> = [
    ["lower amount", (p) => verified(p, { amountCents: p.amountCents - 100 })],
    ["higher amount", (p) => verified(p, { amountCents: p.amountCents + 100 })],
    ["currency", (p) => verified(p, { currency: "USD" })],
    ["checkout id", (p) => verified(p, { checkoutId: "someone-elses-checkout" })],
  ];
  for (const [label, build] of cases) {
    const f = await boostFixture();
    assert.equal(await applyVerifiedPayment("peach", build(f.payment), { webhookEventId: `evt_${run}_mm_${f.ref}` }), "mismatch", label);
    assert.equal((await prisma.boost.findUniqueOrThrow({ where: { id: f.boost.id } })).status === "ACTIVE", false, label);
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } })).failureReason, "verification_mismatch", label);
  }
  assert.equal(await applyVerifiedPayment("peach", { providerRef: "VMDOESNOTEXIST00", state: "SUCCEEDED", amountCents: 4900, currency: "ZAR" }), "unknown_reference");
  const f = await boostFixture();
  assert.equal(await applyVerifiedPayment("payfast", verified(f.payment)), "wrong_provider");
  assert.notEqual((await prisma.boost.findUniqueOrThrow({ where: { id: f.boost.id } })).status, "ACTIVE");
});

test("boost: never renews — no renewal charge or payment is ever created after expiry", async () => {
  const f = await boostFixture();
  const start = new Date("2026-05-01T00:00:00Z");
  await applyVerifiedPayment("peach", verified(f.payment), { now: start });
  const provider = fakeProvider(chargeResult("SUCCEEDED"));
  const later = new Date(start.getTime() + 60 * DAY);
  await processDueRenewals(provider, later);
  assert.equal(await prisma.payment.count({ where: { userId: f.user.id } }), 1, "no renewal payment was created for the boost");
  const boost = await prisma.boost.findUniqueOrThrow({ where: { id: f.boost.id } });
  assert.equal(boost.expiresAt?.getTime(), start.getTime() + 7 * DAY, "expiry never moves without a new purchase");
});

// ---------- Virtual Store subscription ----------

test("subscription: initial verified payment activates, stores token and next billing date", async () => {
  const f = await shopFixture();
  const p = await initialSubPayment(f.subscription.id, f.user.id);
  const now = new Date("2026-05-01T10:00:00Z");
  assert.equal(await applyVerifiedPayment("peach", verified(p, { token: "tok_abc", initialTxId: "init_1" }), { now, webhookEventId: `evt_${run}_s1` }), "activated");
  const sub = await prisma.shopSubscription.findUniqueOrThrow({ where: { id: f.subscription.id } });
  assert.equal(sub.status, "ACTIVE");
  assert.equal(sub.autoRenew, true);
  assert.equal(sub.providerToken, "tok_abc");
  assert.equal(sub.providerInitialTxId, "init_1");
  assert.equal(sub.expiresAt?.getTime(), now.getTime() + 30 * DAY);
  assert.equal(sub.renewsAt?.getTime(), now.getTime() + 30 * DAY);
  assert.equal((await prisma.shop.findUniqueOrThrow({ where: { id: f.shop.id } })).subscriptionStatus, "ACTIVE");
});

test("subscription: pending, failed and unverified payments never activate it", async () => {
  for (const state of ["PENDING", "FAILED", "CANCELLED"] as const) {
    const f = await shopFixture();
    const p = await initialSubPayment(f.subscription.id, f.user.id);
    await applyVerifiedPayment("peach", verified(p, { state, token: "tok_should_not_store" }), { webhookEventId: `evt_${run}_sp_${state}_${p.providerRef}` });
    const sub = await prisma.shopSubscription.findUniqueOrThrow({ where: { id: f.subscription.id } });
    assert.equal(sub.status, "PENDING", state);
    assert.equal(sub.autoRenew, false, state);
    assert.equal(sub.providerToken, null, state);
    assert.equal(subscriptionState(sub).active, false, state);
  }
  const f = await shopFixture();
  await initialSubPayment(f.subscription.id, f.user.id);
  assert.equal(subscriptionState(await prisma.shopSubscription.findUniqueOrThrow({ where: { id: f.subscription.id } })).active, false);
});

test("subscription: amount mismatch never activates", async () => {
  const f = await shopFixture();
  const p = await initialSubPayment(f.subscription.id, f.user.id);
  assert.equal(await applyVerifiedPayment("peach", verified(p, { amountCents: 100, token: "tok" })), "mismatch");
  assert.equal((await prisma.shopSubscription.findUniqueOrThrow({ where: { id: f.subscription.id } })).status, "PENDING");
});

test("subscription: duplicate initial webhook cannot extend the period or charge twice", async () => {
  const f = await shopFixture();
  const p = await initialSubPayment(f.subscription.id, f.user.id);
  const now = new Date("2026-05-01T10:00:00Z");
  await applyVerifiedPayment("peach", verified(p, { token: "tok" }), { now, webhookEventId: `evt_${run}_sd1` });
  await applyVerifiedPayment("peach", verified(p, { token: "tok" }), { now: new Date(now.getTime() + DAY), webhookEventId: `evt_${run}_sd1` });
  await applyVerifiedPayment("peach", verified(p, { token: "tok" }), { now: new Date(now.getTime() + DAY), webhookEventId: `evt_${run}_sd2` });
  assert.equal((await prisma.shopSubscription.findUniqueOrThrow({ where: { id: f.subscription.id } })).expiresAt?.getTime(), now.getTime() + 30 * DAY);
});

test("subscription: without a provider token it activates for one period but does not auto-renew", async () => {
  const f = await shopFixture();
  const p = await initialSubPayment(f.subscription.id, f.user.id);
  await applyVerifiedPayment("peach", verified(p));
  const sub = await prisma.shopSubscription.findUniqueOrThrow({ where: { id: f.subscription.id } });
  assert.equal(sub.status, "ACTIVE");
  assert.equal(sub.autoRenew, false);
  const provider = fakeProvider(chargeResult("SUCCEEDED"));
  await processDueRenewals(provider, new Date(Date.now() + 60 * DAY));
  assert.equal(await prisma.payment.count({ where: { subscriptionId: f.subscription.id } }), 1, "only the initial payment exists; no renewal was charged");
});

test("renewal: a due subscription is charged once, extends the period and cannot be double-charged", async () => {
  const now = new Date("2026-06-01T03:00:00Z");
  const expires = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const f = await shopFixture({ sub: { status: "ACTIVE", expiresAt: expires, autoRenew: true, token: "tok_r" } });
  const provider = fakeProvider(chargeResult("SUCCEEDED"));
  const first = await processDueRenewals(provider, now);
  assert.ok(first.charged >= 1);
  const again = await processDueRenewals(provider, now);
  assert.equal(again.charged, 0);
  assert.equal(await prisma.payment.count({ where: { subscriptionId: f.subscription.id, kind: "RENEWAL" } }), 1);
  const sub = await prisma.shopSubscription.findUniqueOrThrow({ where: { id: f.subscription.id } });
  assert.equal(sub.expiresAt?.getTime(), expires.getTime() + 30 * DAY);
  assert.equal(sub.renewalAttempts, 0);
  const renewals = await prisma.payment.findMany({ where: { subscriptionId: f.subscription.id, kind: "RENEWAL" } });
  assert.equal(renewals[0].status, "SUCCEEDED");
  assert.equal(renewals[0].amountCents, 5900);
});

test("renewal: concurrent cron runs charge a subscription once", async () => {
  const now = new Date("2026-06-01T03:00:00Z");
  const f = await shopFixture({ sub: { status: "ACTIVE", expiresAt: new Date(now.getTime() + 3600_000), autoRenew: true, token: "tok_c" } });
  const provider = fakeProvider(async (input) => { await new Promise((r) => setTimeout(r, 50)); return chargeResult("SUCCEEDED")(input); });
  await Promise.all([processDueRenewals(provider, now), processDueRenewals(provider, now), processDueRenewals(provider, now)]);
  assert.equal(await prisma.payment.count({ where: { subscriptionId: f.subscription.id, kind: "RENEWAL" } }), 1);
});

test("renewal: failures keep the paid period, schedule retries, then stop auto-renewing", async () => {
  let now = new Date("2026-06-01T03:00:00Z");
  const expires = new Date(now.getTime() + 3600_000);
  const f = await shopFixture({ sub: { status: "ACTIVE", expiresAt: expires, autoRenew: true, token: "tok_f" } });
  const provider = fakeProvider(chargeResult("FAILED"));
  for (let attempt = 1; attempt <= MAX_RENEWAL_ATTEMPTS; attempt++) {
    await processDueRenewals(provider, now);
    const sub = await prisma.shopSubscription.findUniqueOrThrow({ where: { id: f.subscription.id } });
    assert.equal(sub.renewalAttempts, attempt);
    assert.equal(sub.expiresAt?.getTime(), expires.getTime(), "a failed renewal never extends access");
    if (attempt < MAX_RENEWAL_ATTEMPTS) {
      assert.equal(sub.autoRenew, true);
      assert.ok(sub.renewsAt && sub.renewsAt > now, "retry is scheduled in the future");
      now = new Date(sub.renewsAt.getTime());
    } else {
      assert.equal(sub.autoRenew, false, "gives up after the maximum attempts");
    }
  }
  assert.equal(await prisma.payment.count({ where: { subscriptionId: f.subscription.id, kind: "RENEWAL", status: "FAILED" } }), MAX_RENEWAL_ATTEMPTS);
  await processDueRenewals(provider, new Date(now.getTime() + 90 * DAY));
  assert.equal(await prisma.payment.count({ where: { subscriptionId: f.subscription.id, kind: "RENEWAL" } }), MAX_RENEWAL_ATTEMPTS, "no further charges after giving up");
});

test("renewal: a successful retry after a failure recovers the subscription", async () => {
  const now = new Date("2026-06-01T03:00:00Z");
  const expires = new Date(now.getTime() + 3600_000);
  const f = await shopFixture({ sub: { status: "ACTIVE", expiresAt: expires, autoRenew: true, token: "tok_rr" } });
  await processDueRenewals(fakeProvider(chargeResult("FAILED")), now);
  const retryAt = (await prisma.shopSubscription.findUniqueOrThrow({ where: { id: f.subscription.id } })).renewsAt!;
  await processDueRenewals(fakeProvider(chargeResult("SUCCEEDED")), retryAt);
  const sub = await prisma.shopSubscription.findUniqueOrThrow({ where: { id: f.subscription.id } });
  assert.equal(sub.renewalAttempts, 0);
  assert.equal(sub.autoRenew, true);
  assert.equal(sub.expiresAt?.getTime(), retryAt.getTime() + 30 * DAY, "lapsed period restarts from the successful payment");
});

test("renewal: an unconfirmed charge (provider error) blocks a second charge", async () => {
  const now = new Date("2026-06-01T03:00:00Z");
  const f = await shopFixture({ sub: { status: "ACTIVE", expiresAt: new Date(now.getTime() + 3600_000), autoRenew: true, token: "tok_u" } });
  const provider = fakeProvider(async () => { throw new Error("network down"); });
  await processDueRenewals(provider, now);
  await prisma.shopSubscription.update({ where: { id: f.subscription.id }, data: { renewsAt: now } });
  await processDueRenewals(provider, new Date(now.getTime() + 60_000));
  assert.equal(await prisma.payment.count({ where: { subscriptionId: f.subscription.id, kind: "RENEWAL" } }), 1, "no second charge while the first is unconfirmed");
});

test("renewal: suspended owners are not charged", async () => {
  const now = new Date("2026-06-01T03:00:00Z");
  const f = await shopFixture({ sub: { status: "ACTIVE", expiresAt: new Date(now.getTime() + 3600_000), autoRenew: true, token: "tok_s" } });
  await prisma.user.update({ where: { id: f.user.id }, data: { status: "SUSPENDED" } });
  await processDueRenewals(fakeProvider(chargeResult("SUCCEEDED")), now);
  assert.equal(await prisma.payment.count({ where: { subscriptionId: f.subscription.id } }), 0);
});

test("cancellation: stops renewals, deletes the token and keeps access until the paid period ends", async () => {
  const now = new Date();
  const expires = new Date(now.getTime() + 10 * DAY);
  const f = await shopFixture({ sub: { status: "ACTIVE", expiresAt: expires, autoRenew: true, token: "tok_x" } });
  const deleted: string[] = [];
  const original = peachProvider.deleteStoredToken;
  peachProvider.deleteStoredToken = async (token: string) => { deleted.push(token); };
  try {
    const result = await cancelShopSubscription(f.shop.id, now);
    assert.equal(result.ok, true);
    assert.deepEqual(deleted, ["tok_x"]);
    const sub = await prisma.shopSubscription.findUniqueOrThrow({ where: { id: f.subscription.id } });
    assert.equal(sub.autoRenew, false);
    assert.equal(sub.providerToken, null);
    assert.ok(sub.cancelledAt);
    assert.equal(sub.status, "ACTIVE");
    assert.equal(subscriptionState(sub, now).active, true, "access preserved until paid period ends");
    assert.equal(subscriptionState(sub, new Date(expires.getTime() + 1000)).active, false, "no access after the period ends");
    const provider = fakeProvider(chargeResult("SUCCEEDED"));
    await processDueRenewals(provider, new Date(expires.getTime() + DAY));
    assert.equal(provider.tokens.includes("tok_x"), false, "no renewal after cancellation");
    assert.equal((await cancelShopSubscription(f.shop.id, now)).ok, false, "cancelling twice is rejected");
  } finally {
    peachProvider.deleteStoredToken = original;
  }
});

test("cancellation: still stops renewals when the provider token deletion fails", async () => {
  const f = await shopFixture({ sub: { status: "ACTIVE", expiresAt: new Date(Date.now() + 5 * DAY), autoRenew: true, token: "tok_y" } });
  const original = peachProvider.deleteStoredToken;
  peachProvider.deleteStoredToken = async () => { throw new Error("provider unavailable"); };
  try {
    const result = await cancelShopSubscription(f.shop.id);
    assert.equal(result.ok && result.tokenRemoved, false);
  } finally {
    peachProvider.deleteStoredToken = original;
  }
  const sub = await prisma.shopSubscription.findUniqueOrThrow({ where: { id: f.subscription.id } });
  assert.equal(sub.autoRenew, false);
  assert.equal(sub.lastRenewalError, "token_delete_failed");
  const provider = fakeProvider(chargeResult("SUCCEEDED"));
  await processDueRenewals(provider, new Date(Date.now() + 60 * DAY));
  assert.equal(await prisma.payment.count({ where: { subscriptionId: f.subscription.id } }), 0);
});

// ---------- HTTP routes ----------

function signedWebhook(checkoutId: string, ref: string, eventId: string, opts: { secret?: string } = {}) {
  const body = new URLSearchParams({ checkoutId, merchantTransactionId: ref, "result.code": "000.000.000", amount: "1.00" }).toString();
  const url = peachWebhookUrl(secureAppUrl());
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", opts.secret ?? WEBHOOK_SECRET).update(`${timestamp}.${eventId}.${url}.${body}`).digest("hex");
  return new NextRequest(url, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", "x-webhook-signature": signature, "x-webhook-timestamp": timestamp, "x-webhook-id": eventId } });
}

function stubStatus(fn: PaymentProvider["fetchCheckoutStatus"]) {
  const original = peachProvider.fetchCheckoutStatus;
  peachProvider.fetchCheckoutStatus = fn;
  return () => { peachProvider.fetchCheckoutStatus = original; };
}

test("webhook route: forged signature is rejected and changes nothing", async () => {
  const f = await boostFixture();
  let called = 0;
  const restore = stubStatus(async () => { called++; return verified(f.payment); });
  try {
    const response = await webhookPOST(signedWebhook(f.payment.providerCheckoutId!, f.ref, `evt_${run}_forged`, { secret: "attacker-guess" }));
    assert.equal(response.status, 401);
    assert.equal(called, 0, "no provider lookup for unauthenticated requests");
    const unsigned = await webhookPOST(new NextRequest(peachWebhookUrl(secureAppUrl()), { method: "POST", body: `checkoutId=${f.payment.providerCheckoutId}` }));
    assert.equal(unsigned.status, 401);
  } finally { restore(); }
  assert.notEqual((await prisma.boost.findUniqueOrThrow({ where: { id: f.boost.id } })).status, "ACTIVE");
});

test("webhook route: a signed webhook cannot force success — the provider's own status decides", async () => {
  const f = await boostFixture();
  const restore = stubStatus(async () => verified(f.payment, { state: "PENDING" }));
  try {
    const response = await webhookPOST(signedWebhook(f.payment.providerCheckoutId!, f.ref, `evt_${run}_claimsok`));
    assert.equal(response.status, 200);
  } finally { restore(); }
  assert.notEqual((await prisma.boost.findUniqueOrThrow({ where: { id: f.boost.id } })).status, "ACTIVE");
});

test("webhook route: genuine success activates once; replay of the same request does nothing more", async () => {
  const f = await boostFixture();
  const restore = stubStatus(async () => verified(f.payment));
  try {
    const eventId = `evt_${run}_ok_${f.ref}`;
    const first = await webhookPOST(signedWebhook(f.payment.providerCheckoutId!, f.ref, eventId));
    assert.equal((await first.json()).outcome, "activated");
    const replay = await webhookPOST(signedWebhook(f.payment.providerCheckoutId!, f.ref, eventId));
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).outcome, "duplicate_event");
  } finally { restore(); }
  assert.equal((await prisma.boost.findUniqueOrThrow({ where: { id: f.boost.id } })).status, "ACTIVE");
  assert.equal(await prisma.paymentWebhookEvent.count({ where: { providerRef: f.ref } }), 1);
});

test("webhook route: provider lookup failure returns non-200 so Peach retries, and activates nothing", async () => {
  const f = await boostFixture();
  const restore = stubStatus(async () => { throw new Error("peach down"); });
  try {
    const response = await webhookPOST(signedWebhook(f.payment.providerCheckoutId!, f.ref, `evt_${run}_err`));
    assert.equal(response.status, 500);
  } finally { restore(); }
  assert.notEqual((await prisma.boost.findUniqueOrThrow({ where: { id: f.boost.id } })).status, "ACTIVE");
});

test("return route: the browser redirect alone never activates anything; only a server-side lookup does", async () => {
  const f = await boostFixture();
  const request = () => new NextRequest(`${secureAppUrl()}/api/payments/return?ref=${f.ref}&status=success&result.code=000.000.000`);
  let restore = stubStatus(async () => verified(f.payment, { state: "PENDING" }));
  try {
    const response = await returnGET(request());
    assert.equal(response.status, 303);
    assert.match(response.headers.get("location") ?? "", /\/payments\/status\?ref=/);
  } finally { restore(); }
  assert.notEqual((await prisma.boost.findUniqueOrThrow({ where: { id: f.boost.id } })).status, "ACTIVE");
  restore = stubStatus(async () => verified(f.payment));
  try { await returnGET(request()); } finally { restore(); }
  assert.equal((await prisma.boost.findUniqueOrThrow({ where: { id: f.boost.id } })).status, "ACTIVE");
});

test("renewals route: requires the cron secret", async () => {
  const url = `${secureAppUrl()}/api/payments/renewals`;
  assert.equal((await renewalsGET(new NextRequest(url))).status, 401);
  assert.equal((await renewalsGET(new NextRequest(url, { headers: { authorization: "Bearer wrong" } }))).status, 401);
});
