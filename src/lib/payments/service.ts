import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { secureAppUrl } from "@/lib/app-url";
import type { PaymentProvider, VerifiedPayment } from "./provider";
import { getProviderById } from "./registry";

/**
 * Provider-independent payment business rules for boosts and the Virtual Store.
 * Nothing here knows about Peach: it consumes VerifiedPayment values that a provider
 * adapter produced from a server-to-server lookup.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const SUBSCRIPTION_PERIOD_DAYS = 30;
// Renewals are charged up to this long before expiry so service never lapses between cron runs.
export const RENEWAL_LEAD_MS = DAY_MS;
// First charge + two retries. Delays are measured against renewsAt, which the job reads RENEWAL_LEAD_MS early.
export const MAX_RENEWAL_ATTEMPTS = 3;
export const RENEWAL_RETRY_DELAYS_MS = [2 * DAY_MS, 4 * DAY_MS];
export const UNCONFIRMED_RENEWAL_AFTER_MS = DAY_MS;
export const PENDING_CHECKOUT_WINDOW_MS = 35 * 60 * 1000;

const BOOST_DAYS = { ONE_DAY: 1, THREE_DAYS: 3, SEVEN_DAYS: 7, THIRTY_DAYS: 30 } as const;

/** 16 chars: fits Peach's 8-16 character merchantTransactionId rule and is unguessable. */
export function newPaymentRef(): string {
  return `VM${randomBytes(7).toString("hex").toUpperCase()}`;
}

export function boostExpiry(startsAt: Date, boost: { durationDays: number | null; duration: keyof typeof BOOST_DAYS }): Date {
  const days = boost.durationDays ?? BOOST_DAYS[boost.duration];
  return new Date(startsAt.getTime() + days * DAY_MS);
}

/** Next paid period: extends the running period, otherwise starts now. */
export function nextSubscriptionExpiry(currentExpiresAt: Date | null, now: Date): Date {
  const base = currentExpiresAt && currentExpiresAt > now ? currentExpiresAt : now;
  return new Date(base.getTime() + SUBSCRIPTION_PERIOD_DAYS * DAY_MS);
}

export function paymentReturnUrl(providerRef: string) {
  return `${secureAppUrl()}/api/payments/return?ref=${encodeURIComponent(providerRef)}`;
}

/** Webhook URL registered with the provider for a checkout (route: /api/payments/<provider>/webhook). */
export function providerNotifyUrl(providerId: string) {
  return `${secureAppUrl()}/api/payments/${providerId}/webhook`;
}

/**
 * Creates the hosted checkout for an already-stored PENDING payment. If the provider
 * rejects the request, the pending payment (and boost) is closed so nothing is left
 * dangling or activatable.
 */
export async function startProviderCheckout(provider: PaymentProvider, paymentId: string, options: { recurring: boolean; notifyUrl: string }) {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  try {
    const checkout = await provider.createCheckout({ providerRef: payment.providerRef, amountCents: payment.amountCents, currency: "ZAR", returnUrl: paymentReturnUrl(payment.providerRef), notifyUrl: options.notifyUrl, recurring: options.recurring });
    await prisma.payment.update({ where: { id: payment.id }, data: { providerCheckoutId: checkout.checkoutId } });
    return { redirectUrl: checkout.redirectUrl, reference: payment.providerRef };
  } catch (error) {
    await prisma.$transaction([
      prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED", failureReason: "checkout_creation_failed" } }),
      prisma.boost.updateMany({ where: { paymentId: payment.id, status: "PENDING_PAYMENT" }, data: { status: "CANCELLED" } }),
    ]);
    throw error;
  }
}

export type ApplyOutcome = "activated" | "failed" | "pending" | "already_processed" | "duplicate_event" | "unknown_reference" | "mismatch" | "wrong_provider";

type PaymentWithTargets = Prisma.PaymentGetPayload<{ include: { boost: true; subscription: true; shopSubscription: true } }>;

/**
 * The single place a payment changes state. `verified` MUST come from a provider
 * server-to-server response. Every guard below is a compare-and-set on the payment
 * status, so concurrent or repeated deliveries can only apply once.
 */
export async function applyVerifiedPayment(providerId: string, verified: VerifiedPayment, options: { webhookEventId?: string; now?: Date } = {}): Promise<ApplyOutcome> {
  const now = options.now ?? new Date();
  const payment = await prisma.payment.findUnique({ where: { providerRef: verified.providerRef }, include: { boost: true, subscription: true, shopSubscription: true } });
  if (!payment) return recordEvent(providerId, options.webhookEventId, verified.providerRef, "unknown_reference");
  if (payment.provider !== providerId) return recordEvent(providerId, options.webhookEventId, payment.providerRef, "wrong_provider");

  const mismatch =
    verified.currency !== payment.currency ||
    verified.amountCents !== payment.amountCents ||
    (verified.checkoutId && payment.providerCheckoutId && verified.checkoutId !== payment.providerCheckoutId);
  if (mismatch) {
    // A success that does not match what we asked for must never activate anything.
    await prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED", failureReason: "verification_mismatch" } });
    return recordEvent(providerId, options.webhookEventId, payment.providerRef, "mismatch");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (options.webhookEventId) {
        await tx.paymentWebhookEvent.create({ data: { provider: providerId, eventId: options.webhookEventId, providerRef: payment.providerRef, outcome: verified.state } });
      }
      if (verified.state === "SUCCEEDED") return applySuccess(tx, payment, verified, providerId, now);
      if (verified.state === "PENDING") return "pending";
      return applyFailure(tx, payment, verified, now);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && options.webhookEventId) return "duplicate_event";
    throw error;
  }
}

async function recordEvent(providerId: string, eventId: string | undefined, providerRef: string, outcome: ApplyOutcome): Promise<ApplyOutcome> {
  if (eventId) await prisma.paymentWebhookEvent.create({ data: { provider: providerId, eventId, providerRef, outcome } }).catch(() => undefined);
  return outcome;
}

async function applySuccess(tx: Prisma.TransactionClient, payment: PaymentWithTargets, verified: VerifiedPayment, providerId: string, now: Date): Promise<ApplyOutcome> {
  // PENDING normally; FAILED/CANCELLED may legitimately become SUCCEEDED later (Peach documents "uncertain/cancelled -> successful").
  const claimed = await tx.payment.updateMany({ where: { id: payment.id, status: { in: ["PENDING", "FAILED", "CANCELLED"] } }, data: { status: "SUCCEEDED", verifiedAt: now, failureReason: null, providerPaymentId: verified.providerPaymentId ?? payment.providerPaymentId } });
  if (claimed.count === 0) return "already_processed";

  if (payment.purpose === "BOOST" && payment.boost) {
    const startsAt = now;
    const expiresAt = boostExpiry(startsAt, payment.boost);
    const activated = await tx.boost.updateMany({ where: { id: payment.boost.id, status: { in: ["PENDING_PAYMENT", "CANCELLED"] } }, data: { status: "ACTIVE", startsAt, expiresAt } });
    if (activated.count > 0) await tx.notification.create({ data: { userId: payment.userId, type: "BOOST_ACTIVATED", title: "Boost activated", body: `Your boost is active until ${expiresAt.toLocaleDateString("en-ZA")}. It will not renew automatically.`, link: "/profile/boosts" } });
    return "activated";
  }

  const sub = payment.subscription ?? payment.shopSubscription;
  if (payment.purpose === "VIRTUAL_STORE_SUBSCRIPTION" && sub) {
    const expiresAt = nextSubscriptionExpiry(sub.expiresAt, now);
    const recurring = Boolean(verified.token) && Boolean(getProviderById(providerId)?.supportsRecurring);
    await tx.shopSubscription.update({
      where: { id: sub.id },
      data: {
        status: "ACTIVE",
        startsAt: sub.startsAt ?? now,
        expiresAt,
        renewsAt: expiresAt,
        paymentId: payment.id,
        provider: providerId,
        renewalAttempts: 0,
        lastRenewalError: null,
        ...(payment.kind === "INITIAL" ? { cancelledAt: null } : {}),
        // Only an initial (customer-present, tokenising) payment can enrol the subscription in auto-renewal.
        ...(payment.kind === "INITIAL" && recurring ? { autoRenew: true, providerToken: verified.token, providerInitialTxId: verified.initialTxId ?? null } : {}),
      },
    });
    await tx.shop.update({ where: { id: sub.shopId }, data: { subscriptionStatus: "ACTIVE" } });
    const renewal = payment.kind === "RENEWAL";
    await tx.notification.create({ data: { userId: payment.userId, type: "STORE_SUBSCRIPTION_ACTIVE", title: renewal ? "Virtual Store renewed" : "Virtual Store subscription active", body: `Your Virtual Store subscription is paid until ${expiresAt.toLocaleDateString("en-ZA")}.`, link: "/profile/shops", dedupeKey: `store-sub-paid:${payment.id}` } });
    return "activated";
  }
  return "activated";
}

async function applyFailure(tx: Prisma.TransactionClient, payment: PaymentWithTargets, verified: VerifiedPayment, now: Date): Promise<ApplyOutcome> {
  const status = verified.state === "CANCELLED" ? "CANCELLED" : "FAILED";
  const claimed = await tx.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status, failureReason: verified.reason?.slice(0, 300) ?? status.toLowerCase() } });
  if (claimed.count === 0) return "already_processed";

  if (payment.boost) await tx.boost.updateMany({ where: { id: payment.boost.id, status: "PENDING_PAYMENT" }, data: { status: "CANCELLED" } });

  const sub = payment.subscription ?? payment.shopSubscription;
  if (payment.purpose === "VIRTUAL_STORE_SUBSCRIPTION" && sub) {
    if (payment.kind === "INITIAL") {
      // A never-activated subscription goes back to unpaid; an already-paid one keeps running.
      await tx.shopSubscription.updateMany({ where: { id: sub.id, status: "PENDING" }, data: { lastRenewalError: verified.reason?.slice(0, 300) ?? null } });
    } else {
      const attempts = sub.renewalAttempts + 1;
      const giveUp = attempts >= MAX_RENEWAL_ATTEMPTS;
      await tx.shopSubscription.update({
        where: { id: sub.id },
        data: { renewalAttempts: attempts, lastRenewalError: verified.reason?.slice(0, 300) ?? "renewal_failed", ...(giveUp ? { autoRenew: false } : { renewsAt: new Date(now.getTime() + RENEWAL_RETRY_DELAYS_MS[attempts - 1]) }) },
      });
      const owner = await tx.shop.findUnique({ where: { id: sub.shopId }, select: { ownerId: true, name: true } });
      if (owner) await tx.notification.create({ data: { userId: owner.ownerId, type: "SHOP_UPDATE", title: giveUp ? "Virtual Store renewal failed" : "Virtual Store payment failed", body: giveUp ? `We could not renew ${owner.name} after ${attempts} attempts. Subscribe again to keep your store online.` : `We could not charge your card for ${owner.name}. We will try again automatically.`, link: "/profile/shops", dedupeKey: `store-renewal-failed:${payment.id}` } });
    }
  }
  return "failed";
}

/** Server-side verification of a payment we created, e.g. after the customer returns from checkout. */
export async function reconcilePayment(providerRef: string): Promise<ApplyOutcome | "not_found" | "no_checkout" | "provider_error"> {
  const payment = await prisma.payment.findUnique({ where: { providerRef }, select: { provider: true, providerCheckoutId: true, status: true } });
  if (!payment) return "not_found";
  if (payment.status === "SUCCEEDED") return "already_processed";
  const provider = getProviderById(payment.provider);
  if (!provider || !payment.providerCheckoutId) return "no_checkout";
  try {
    const verified = await provider.fetchCheckoutStatus(payment.providerCheckoutId);
    return await applyVerifiedPayment(provider.id, { ...verified, providerRef });
  } catch {
    return "provider_error";
  }
}

/**
 * Cron entry point: charges every auto-renewing subscription that is due. Safe to run
 * repeatedly — each subscription is claimed with a compare-and-set before any charge,
 * and an unconfirmed earlier attempt blocks a second charge.
 */
export async function processDueRenewals(provider: PaymentProvider, now: Date = new Date()) {
  const summary = { due: 0, charged: 0, failed: 0, skipped: 0, errors: 0 };
  if (!provider.supportsRecurring) return summary;
  const due = await prisma.shopSubscription.findMany({
    where: { autoRenew: true, providerToken: { not: null }, provider: provider.id, renewsAt: { lte: new Date(now.getTime() + RENEWAL_LEAD_MS) }, status: { in: ["ACTIVE", "EXPIRED"] } },
    include: { shop: { select: { ownerId: true, status: true, owner: { select: { status: true } } } } },
    take: 50,
  });
  summary.due = due.length;
  for (const sub of due) {
    if (!sub.providerToken || !sub.renewsAt) continue;
    if (sub.shop.status === "REMOVED") {
      await prisma.shopSubscription.update({ where: { id: sub.id }, data: { autoRenew: false, cancelledAt: now } });
      summary.skipped++;
      continue;
    }
    if (sub.shop.owner.status !== "ACTIVE") { summary.skipped++; continue; }

    const staleCutoff = new Date(now.getTime() - UNCONFIRMED_RENEWAL_AFTER_MS);
    await prisma.payment.updateMany({ where: { subscriptionId: sub.id, kind: "RENEWAL", status: "PENDING", createdAt: { lt: staleCutoff } }, data: { status: "FAILED", failureReason: "unconfirmed_renewal" } });
    const inFlight = await prisma.payment.count({ where: { subscriptionId: sub.id, kind: "RENEWAL", status: "PENDING" } });
    if (inFlight > 0) { summary.skipped++; continue; }

    const claimed = await prisma.shopSubscription.updateMany({ where: { id: sub.id, renewsAt: sub.renewsAt, autoRenew: true }, data: { renewsAt: new Date(now.getTime() + RENEWAL_LEAD_MS + 2 * 60 * 60 * 1000) } });
    if (claimed.count === 0) { summary.skipped++; continue; }

    const payment = await prisma.payment.create({ data: { userId: sub.shop.ownerId, purpose: "VIRTUAL_STORE_SUBSCRIPTION", amountCents: sub.monthlyPriceCents, currency: "ZAR", status: "PENDING", provider: provider.id, providerRef: newPaymentRef(), kind: "RENEWAL", subscriptionId: sub.id } });
    try {
      const verified = await provider.chargeStoredToken({ token: sub.providerToken, initialTxId: sub.providerInitialTxId, providerRef: payment.providerRef, amountCents: payment.amountCents, currency: "ZAR" });
      const outcome = await applyVerifiedPayment(provider.id, verified, { now });
      if (outcome === "activated") summary.charged++;
      else if (outcome === "failed") summary.failed++;
      else summary.skipped++;
    } catch {
      // The charge may or may not have happened; leave the payment PENDING so it is never double-charged.
      summary.errors++;
    }
  }
  return summary;
}

export type CancelResult = { ok: true; accessUntil: Date | null; tokenRemoved: boolean } | { ok: false; error: string; status: number };

/**
 * Stops future renewals. Our own scheduler is what charges, so clearing autoRenew
 * guarantees no further charge even if the provider call fails; the provider token is
 * then deleted too (retried if the first attempt fails). Access continues until the paid period ends.
 */
export async function cancelShopSubscription(shopId: string, now: Date = new Date()): Promise<CancelResult> {
  const sub = await prisma.shopSubscription.findUnique({ where: { shopId } });
  if (!sub) return { ok: false, error: "No subscription found for this store.", status: 404 };
  if (!sub.autoRenew && !sub.providerToken) return { ok: false, error: "This subscription is not set to renew.", status: 409 };

  await prisma.shopSubscription.update({ where: { id: sub.id }, data: { autoRenew: false, cancelledAt: sub.cancelledAt ?? now } });
  let tokenRemoved = true;
  if (sub.providerToken) {
    const provider = sub.provider ? getProviderById(sub.provider) : undefined;
    try {
      if (!provider) throw new Error("provider unavailable");
      await provider.deleteStoredToken(sub.providerToken);
      await prisma.shopSubscription.update({ where: { id: sub.id }, data: { providerToken: null, providerInitialTxId: null, lastRenewalError: null } });
    } catch {
      tokenRemoved = false;
      await prisma.shopSubscription.update({ where: { id: sub.id }, data: { lastRenewalError: "token_delete_failed" } });
    }
  }
  return { ok: true, accessUntil: sub.expiresAt && sub.expiresAt > now ? sub.expiresAt : null, tokenRemoved };
}
