import { createHmac, timingSafeEqual } from "node:crypto";
import type { CheckoutInput, PaymentProvider, VerifiedPayment, VerifiedState, WebhookVerification } from "../provider";

/**
 * Peach Payments adapter — the ONLY place Peach endpoints, parameters and signature
 * rules live. Sources (official docs, developer.peachpayments.com):
 *  - Authentication:   POST {auth}/api/oauth/token            (docs/checkout-embedded-authentication)
 *  - Create checkout:  POST {checkout}/v2/checkout            (reference/post_v2-checkout)
 *  - Checkout status:  GET  {checkout}/v2/checkout/{id}/status (reference/get_v2-checkout-checkoutid-status)
 *  - Webhook signing:  HMAC-SHA256 of `${timestamp}.${id}.${url}.${rawBody}` (docs/checkout-webhooks)
 *  - Recurring (MIT):  POST {card}/v1/registrations/{token}/payments, DELETE {card}/v1/registrations/{token}
 *                      (docs/oppwa-guides-card-on-file, oppwa-integrations-server-to-server-registration-tokens)
 */

type PeachEnv = "sandbox" | "live";

const HOSTS = {
  sandbox: { auth: "https://sandbox-dashboard.peachpayments.com", checkout: "https://testsecure.peachpayments.com", card: "https://sandbox-card.peachpayments.com" },
  live: { auth: "https://dashboard.peachpayments.com", checkout: "https://secure.peachpayments.com", card: "https://card.peachpayments.com" },
} as const;

export function peachEnvironment(): PeachEnv {
  return process.env.PEACH_ENV === "live" ? "live" : "sandbox";
}

// Result-code groups from docs/dashboard-response-codes.
const SUCCESS_CODE = /^(000\.000\.|000\.100\.1|000\.[36]|000\.400\.[1][12]0)/;
const PENDING_CODE = /^(000\.200)/;
const CANCELLED_CODE = /^100\.396\.101$/;

export function classifyResultCode(code: string | undefined | null): VerifiedState {
  if (!code) return "PENDING";
  if (SUCCESS_CODE.test(code)) return "SUCCEEDED";
  if (PENDING_CODE.test(code)) return "PENDING";
  if (CANCELLED_CODE.test(code)) return "CANCELLED";
  return "FAILED";
}

export function parsePeachAmountToCents(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : NaN;
}

export function peachWebhookUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/, "")}/api/payments/peach/webhook`;
}

/** Pure signature check so it can be unit-tested without network or env. */
export function verifyPeachSignature(input: { secret: string; timestamp: string | null; webhookId: string | null; signature: string | null; url: string; rawBody: string }): boolean {
  const { secret, timestamp, webhookId, signature, url, rawBody } = input;
  if (!secret || !timestamp || !webhookId || !signature) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${webhookId}.${url}.${rawBody}`).digest("hex");
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}

function hosts() {
  const base = HOSTS[peachEnvironment()];
  return { ...base, card: process.env.PEACH_CARD_API_URL?.replace(/\/+$/, "") || base.card };
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
  const response = await fetch(`${hosts().auth}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: process.env.PEACH_CLIENT_ID, clientSecret: process.env.PEACH_CLIENT_SECRET, merchantId: process.env.PEACH_MERCHANT_ID }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => null)) as { access_token?: string; expires_in?: string | number } | null;
  if (!response.ok || !body?.access_token) throw new Error("Peach authentication failed");
  cachedToken = { value: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 300) * 1000 };
  return body.access_token;
}

// Peach registration ids are opaque hex-style strings (32 chars in the docs); anything else is not stored as a token.
const REGISTRATION_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

function statusToVerified(body: Record<string, unknown>, fallbackRef?: string): VerifiedPayment {
  const result = (body.result as { code?: string; description?: string } | undefined) ?? undefined;
  const code = (body["result.code"] as string | undefined) ?? result?.code;
  const description = (body["result.description"] as string | undefined) ?? result?.description;
  return {
    providerRef: String(body.merchantTransactionId ?? fallbackRef ?? ""),
    checkoutId: typeof body.checkoutId === "string" ? body.checkoutId : undefined,
    providerPaymentId: typeof body.id === "string" ? body.id : undefined,
    state: classifyResultCode(code),
    amountCents: parsePeachAmountToCents(body.amount),
    currency: String(body.currency ?? ""),
    token: typeof body.registrationId === "string" && REGISTRATION_ID_PATTERN.test(body.registrationId) ? body.registrationId : undefined,
    initialTxId: typeof body.cardholderInitiatedTransactionId === "string" ? body.cardholderInitiatedTransactionId : typeof body.id === "string" ? body.id : undefined,
    reason: description ? `${code}: ${description}` : code,
  };
}

export const peachProvider: PaymentProvider = {
  id: "peach",
  get supportsRecurring() {
    return Boolean(process.env.PEACH_RECURRING_ENTITY_ID && process.env.PEACH_RECURRING_ACCESS_TOKEN);
  },
  config() {
    const missing = ["PEACH_CLIENT_ID", "PEACH_CLIENT_SECRET", "PEACH_MERCHANT_ID", "PEACH_ENTITY_ID", "PEACH_WEBHOOK_SECRET"].filter((key) => !process.env[key]);
    if (peachEnvironment() === "live" && process.env.PEACH_ALLOW_LIVE !== "true") missing.push("PEACH_ALLOW_LIVE=true (live mode needs explicit approval)");
    return { configured: missing.length === 0, missing };
  },

  async createCheckout(input: CheckoutInput) {
    const token = await accessToken();
    const expiry = new Date();
    expiry.setUTCFullYear(expiry.getUTCFullYear() + 3);
    const body: Record<string, unknown> = {
      "authentication.entityId": process.env.PEACH_ENTITY_ID,
      merchantTransactionId: input.providerRef,
      amount: Number((input.amountCents / 100).toFixed(2)),
      currency: input.currency,
      paymentType: "DB",
      nonce: `${input.providerRef}${Date.now().toString(36)}`,
      shopperResultUrl: input.returnUrl,
      notificationUrl: input.notifyUrl,
    };
    if (input.recurring) {
      Object.assign(body, {
        createRegistration: true,
        forceDefaultMethod: true,
        defaultPaymentMethod: "CARD",
        standingInstruction: { type: "RECURRING", mode: "INITIAL", recurringType: "SUBSCRIPTION", frequency: 30, expiry: expiry.toISOString().slice(0, 10) },
      });
    }
    const origin = new URL(input.returnUrl).origin;
    const response = await fetch(`${hosts().checkout}/v2/checkout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Referer: origin, Origin: origin },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await response.json().catch(() => null)) as { checkoutId?: string; redirectUrl?: string } | null;
    if (!response.ok || !data?.checkoutId || !data.redirectUrl) throw new Error("Peach checkout creation failed");
    return { checkoutId: data.checkoutId, redirectUrl: data.redirectUrl };
  },

  async fetchCheckoutStatus(checkoutId) {
    const token = await accessToken();
    const response = await fetch(`${hosts().checkout}/v2/checkout/${encodeURIComponent(checkoutId)}/status`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !data) throw new Error("Peach status lookup failed");
    return { ...statusToVerified(data), checkoutId };
  },

  // Peach's documented merchant-initiated request has no initial-transaction parameter: the
  // gateway links the repeat payment to the registration. `initialTransactionId` only appears in responses.
  async chargeStoredToken({ token, providerRef, amountCents, currency }) {
    const form = new URLSearchParams({
      entityId: process.env.PEACH_RECURRING_ENTITY_ID ?? "",
      amount: (amountCents / 100).toFixed(2),
      currency,
      paymentType: "DB",
      merchantTransactionId: providerRef,
      "standingInstruction.mode": "REPEATED",
      "standingInstruction.type": "RECURRING",
      "standingInstruction.source": "MIT",
      "standingInstruction.recurringType": "SUBSCRIPTION",
    });
    const response = await fetch(`${hosts().card}/v1/registrations/${encodeURIComponent(token)}/payments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.PEACH_RECURRING_ACCESS_TOKEN}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!data) throw new Error("Peach recurring charge returned no body");
    const verified = statusToVerified(data, providerRef);
    // The charge response does not echo our reference reliably; our own request is the reference.
    return { ...verified, providerRef, currency: verified.currency || currency, amountCents: Number.isNaN(verified.amountCents) ? amountCents : verified.amountCents };
  },

  async deleteStoredToken(token) {
    const url = `${hosts().card}/v1/registrations/${encodeURIComponent(token)}?entityId=${encodeURIComponent(process.env.PEACH_RECURRING_ENTITY_ID ?? "")}`;
    const response = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${process.env.PEACH_RECURRING_ACCESS_TOKEN}` }, signal: AbortSignal.timeout(20_000) });
    const data = (await response.json().catch(() => null)) as { result?: { code?: string } } | null;
    if (!response.ok || classifyResultCode(data?.result?.code) !== "SUCCEEDED") throw new Error("Peach token deletion failed");
  },

  verifyWebhook({ headers, rawBody, url }): WebhookVerification {
    const secret = process.env.PEACH_WEBHOOK_SECRET ?? "";
    const webhookId = headers.get("x-webhook-id");
    const valid = verifyPeachSignature({ secret, timestamp: headers.get("x-webhook-timestamp"), webhookId, signature: headers.get("x-webhook-signature"), url, rawBody });
    if (!valid || !webhookId) return { ok: false, reason: "invalid signature" };
    const params = new URLSearchParams(rawBody);
    return { ok: true, eventId: webhookId, checkoutId: params.get("checkoutId"), providerRef: params.get("merchantTransactionId") };
  },
};
