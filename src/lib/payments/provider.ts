/**
 * Provider-neutral payment contract. Business logic (boosts, Virtual Store) only
 * talks to this interface; everything Peach-specific lives in ./peach. To switch to
 * another provider (e.g. Payfast), implement PaymentProvider and register it in
 * ./registry.ts — no change to boost or subscription logic is required.
 */

export type VerifiedState = "SUCCEEDED" | "FAILED" | "CANCELLED" | "PENDING";

/** A payment outcome the provider itself reported to our server (never from the browser). */
export type VerifiedPayment = {
  /** Our own reference (stored in Payment.providerRef). */
  providerRef: string;
  checkoutId?: string;
  providerPaymentId?: string;
  state: VerifiedState;
  amountCents: number;
  currency: string;
  /** Provider-stored payment token, present when tokenisation was requested and succeeded. */
  token?: string;
  initialTxId?: string;
  reason?: string;
};

export type CheckoutInput = {
  providerRef: string;
  amountCents: number;
  currency: "ZAR";
  returnUrl: string;
  notifyUrl: string;
  /** Ask the provider to store a payment token for recurring billing (customer consent is the checkout itself). */
  recurring: boolean;
};

export type WebhookVerification =
  | { ok: true; eventId: string; checkoutId: string | null; providerRef: string | null }
  | { ok: false; reason: string };

export interface PaymentProvider {
  readonly id: string;
  config(): { configured: boolean; missing: string[] };
  /** True only when the provider can charge a stored token without the customer present. */
  readonly supportsRecurring: boolean;
  createCheckout(input: CheckoutInput): Promise<{ checkoutId: string; redirectUrl: string }>;
  /** Server-to-server lookup used to independently verify a payment. */
  fetchCheckoutStatus(checkoutId: string): Promise<VerifiedPayment>;
  chargeStoredToken(input: { token: string; initialTxId: string | null; providerRef: string; amountCents: number; currency: "ZAR" }): Promise<VerifiedPayment>;
  deleteStoredToken(token: string): Promise<void>;
  verifyWebhook(input: { headers: Headers; rawBody: string; url: string }): WebhookVerification;
}
