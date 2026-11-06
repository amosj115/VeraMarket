import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { classifyResultCode, parsePeachAmountToCents, peachProvider, peachWebhookUrl, verifyPeachSignature } from "../../src/lib/payments/peach";
import { boostExpiry, newPaymentRef, nextSubscriptionExpiry } from "../../src/lib/payments/service";

const DAY = 24 * 60 * 60 * 1000;
const URL_ = peachWebhookUrl("https://example.test");
const SECRET = "test-only-secret";
const body = "checkoutId=abc123&merchantTransactionId=VM0123456789ABCD";
const sign = (ts: string, id: string, url = URL_, raw = body, secret = SECRET) => createHmac("sha256", secret).update(`${ts}.${id}.${url}.${raw}`).digest("hex");

test("webhook signature: valid, forged, tampered and incomplete requests", () => {
  const good = { secret: SECRET, timestamp: "1700000000", webhookId: "evt_1", signature: sign("1700000000", "evt_1"), url: URL_, rawBody: body };
  assert.equal(verifyPeachSignature(good), true);
  assert.equal(verifyPeachSignature({ ...good, signature: sign("1700000000", "evt_1", URL_, body, "other-secret") }), false);
  assert.equal(verifyPeachSignature({ ...good, rawBody: `${body}&amount=1` }), false);
  assert.equal(verifyPeachSignature({ ...good, url: "https://evil.test/api/payments/peach/webhook" }), false);
  assert.equal(verifyPeachSignature({ ...good, webhookId: "evt_2" }), false);
  assert.equal(verifyPeachSignature({ ...good, signature: null }), false);
  assert.equal(verifyPeachSignature({ ...good, secret: "" }), false);
});

test("provider.verifyWebhook rejects forged requests and extracts checkout id from signed ones", () => {
  process.env.PEACH_WEBHOOK_SECRET = SECRET;
  const headers = (sig: string) => new Headers({ "x-webhook-signature": sig, "x-webhook-timestamp": "1700000000", "x-webhook-id": "evt_9" });
  const forged = peachProvider.verifyWebhook({ headers: headers("deadbeef"), rawBody: body, url: URL_ });
  assert.equal(forged.ok, false);
  const ok = peachProvider.verifyWebhook({ headers: headers(sign("1700000000", "evt_9")), rawBody: body, url: URL_ });
  assert.deepEqual(ok, { ok: true, eventId: "evt_9", checkoutId: "abc123", providerRef: "VM0123456789ABCD" });
  delete process.env.PEACH_WEBHOOK_SECRET;
  assert.equal(peachProvider.verifyWebhook({ headers: headers(sign("1700000000", "evt_9")), rawBody: body, url: URL_ }).ok, false, "no secret configured must reject everything");
});

test("result codes: only documented success codes succeed; pending and cancelled never succeed", () => {
  for (const code of ["000.000.000", "000.100.110", "000.100.112", "000.300.000", "000.600.000"]) assert.equal(classifyResultCode(code), "SUCCEEDED", code);
  for (const code of ["000.200.000", "000.200.100"]) assert.equal(classifyResultCode(code), "PENDING", code);
  assert.equal(classifyResultCode("100.396.101"), "CANCELLED");
  for (const code of ["800.100.151", "100.100.101", "900.100.100", "garbage"]) assert.equal(classifyResultCode(code), "FAILED", code);
  assert.equal(classifyResultCode(undefined), "PENDING");
  assert.equal(classifyResultCode(""), "PENDING");
});

test("amount parsing converts rands to exact cents and rejects junk", () => {
  assert.equal(parsePeachAmountToCents("59.00"), 5900);
  assert.equal(parsePeachAmountToCents(0.29), 29);
  assert.equal(parsePeachAmountToCents(19.99), 1999);
  assert.ok(Number.isNaN(parsePeachAmountToCents("abc")));
});

test("boost expiry is computed from the server start time and fixed duration", () => {
  const start = new Date("2026-01-01T00:00:00Z");
  assert.equal(boostExpiry(start, { durationDays: null, duration: "ONE_DAY" }).getTime() - start.getTime(), 1 * DAY);
  assert.equal(boostExpiry(start, { durationDays: null, duration: "THREE_DAYS" }).getTime() - start.getTime(), 3 * DAY);
  assert.equal(boostExpiry(start, { durationDays: null, duration: "SEVEN_DAYS" }).getTime() - start.getTime(), 7 * DAY);
  assert.equal(boostExpiry(start, { durationDays: null, duration: "THIRTY_DAYS" }).getTime() - start.getTime(), 30 * DAY);
  assert.equal(boostExpiry(start, { durationDays: 14, duration: "SEVEN_DAYS" }).getTime() - start.getTime(), 14 * DAY, "package durationDays wins");
});

test("subscription period extends a running period and restarts a lapsed one", () => {
  const now = new Date("2026-03-01T00:00:00Z");
  const running = new Date(now.getTime() + 2 * DAY);
  assert.equal(nextSubscriptionExpiry(running, now).getTime(), running.getTime() + 30 * DAY);
  assert.equal(nextSubscriptionExpiry(new Date(now.getTime() - DAY), now).getTime(), now.getTime() + 30 * DAY);
  assert.equal(nextSubscriptionExpiry(null, now).getTime(), now.getTime() + 30 * DAY);
});

test("payment references satisfy the 8-16 character provider rule and are unique", () => {
  const refs = new Set(Array.from({ length: 200 }, () => newPaymentRef()));
  assert.equal(refs.size, 200);
  for (const ref of refs) assert.match(ref, /^VM[0-9A-F]{14}$/);
});

// ---------- Peach HTTP contract (stubbed fetch, dummy env, no network) ----------

type Call = { url: string; method: string; body: string };
async function withPeachStub<T>(respond: (call: Call) => unknown, fn: (calls: Call[]) => Promise<T>) {
  const env = { PEACH_ENVIRONMENT: "sandbox", PEACH_CLIENT_ID: "c", PEACH_CLIENT_SECRET: "s", PEACH_MERCHANT_ID: "m", PEACH_ENTITY_ID: "e", PEACH_RECURRING_ENTITY_ID: "rec-entity", PEACH_RECURRING_ACCESS_TOKEN: "rec-token" };
  Object.assign(process.env, env);
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/oauth/token")) return Response.json({ access_token: "stub", expires_in: 300 });
    const call = { url, method: init?.method ?? "GET", body: String(init?.body ?? "") };
    calls.push(call);
    return Response.json(respond(call));
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real;
    for (const key of Object.keys(env)) delete process.env[key];
  }
}

test("status lookup: only a well-formed registration id is accepted as a token", async () => {
  const statusBody = (registrationId?: string) => ({ "result.code": "000.100.110", merchantTransactionId: "VM0123456789ABCD", checkoutId: "chk1", id: "tx1", amount: "59.00", currency: "ZAR", ...(registrationId ? { registrationId } : {}) });
  const good = await withPeachStub(() => statusBody("8ac7a4a29a9e2455019aa1af83d47a98"), () => peachProvider.fetchCheckoutStatus("chk1"));
  assert.equal(good.token, "8ac7a4a29a9e2455019aa1af83d47a98");
  for (const bad of [undefined, "", "short", "../../evil?x=1", "has space in it 12345"]) {
    const result = await withPeachStub(() => statusBody(bad), () => peachProvider.fetchCheckoutStatus("chk1"));
    assert.equal(result.token, undefined, `token ${String(bad)} must not be stored`);
  }
});

test("merchant-initiated charge uses the documented registration endpoint and fields", async () => {
  await withPeachStub(() => ({ "result.code": "000.100.110", id: "mit1", amount: "59.00", currency: "ZAR" }), async (calls) => {
    await peachProvider.chargeStoredToken({ token: "8ac7a4a29a9e2455019aa1af83d47a98", initialTxId: "ignored", providerRef: "VM0123456789ABCD", amountCents: 5900, currency: "ZAR" });
    const call = calls[0];
    assert.equal(call.method, "POST");
    assert.equal(call.url, "https://sandbox-card.peachpayments.com/v1/registrations/8ac7a4a29a9e2455019aa1af83d47a98/payments");
    const form = new URLSearchParams(call.body);
    assert.equal(form.get("entityId"), "rec-entity");
    assert.equal(form.get("amount"), "59.00");
    assert.equal(form.get("paymentType"), "DB");
    assert.equal(form.get("standingInstruction.mode"), "REPEATED");
    assert.equal(form.get("standingInstruction.source"), "MIT");
    assert.equal(form.get("standingInstruction.type"), "RECURRING");
    assert.equal(form.has("standingInstruction.initialTransactionId"), false, "not a documented request parameter");
  });
});

test("token deletion calls DELETE on the registration with the recurring entity", async () => {
  await withPeachStub(() => ({ result: { code: "000.100.110" } }), async (calls) => {
    await peachProvider.deleteStoredToken("8ac7a4a29a9e2455019aa1af83d47a98");
    assert.equal(calls[0].method, "DELETE");
    assert.equal(calls[0].url, "https://sandbox-card.peachpayments.com/v1/registrations/8ac7a4a29a9e2455019aa1af83d47a98?entityId=rec-entity");
  });
  await withPeachStub(() => ({ result: { code: "800.900.300" } }), async () => {
    await assert.rejects(() => peachProvider.deleteStoredToken("8ac7a4a29a9e2455019aa1af83d47a98"));
  });
});
