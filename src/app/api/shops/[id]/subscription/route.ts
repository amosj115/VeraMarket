import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPaymentProvider } from "@/lib/payments/registry";
import { PENDING_CHECKOUT_WINDOW_MS, cancelShopSubscription, newPaymentRef, providerNotifyUrl, startProviderCheckout } from "@/lib/payments/service";

const RENEWAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Actions: "subscribe" (start the recurring monthly subscription through the payment
// provider), "cancel" (stop future renewals; access continues until the paid period ends),
// "pause" and "reactivate" (store visibility only — they never touch the paid
// subscription, which is owned by the payment/webhook flow).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const shop = await prisma.shop.findFirst({
    where: { id, ownerId: session.user.id },
    include: { subscription: true },
  });
  if (!shop) return NextResponse.json({ error: "Virtual Store not found" }, { status: 404 });

  const { action, autoRenewConsent } = (await request.json().catch(() => ({ action: "subscribe" }))) as { action?: string; autoRenewConsent?: unknown };

  if (action === "pause") {
    await prisma.shop.update({ where: { id }, data: { isPaused: true } });
    return NextResponse.json({ ok: true, paused: true });
  }

  if (action === "reactivate") {
    await prisma.shop.update({ where: { id }, data: { isPaused: false } });
    return NextResponse.json({ ok: true, paused: false });
  }

  if (action === "cancel") {
    const result = await cancelShopSubscription(shop.id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, cancelled: true, accessUntil: result.accessUntil, tokenRemoved: result.tokenRemoved });
  }

  if (action !== "subscribe" && action !== "activate") return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  // Saving a card and charging it every month needs the seller's explicit opt-in.
  if (autoRenewConsent !== true) return NextResponse.json({ error: "Please agree to automatic monthly billing to subscribe." }, { status: 400 });

  const now = new Date();
  const subscription = shop.subscription;
  const activeUntil = subscription?.status === "ACTIVE" && subscription.expiresAt && subscription.expiresAt > now ? subscription.expiresAt : null;
  if (activeUntil && subscription && activeUntil.getTime() - now.getTime() > RENEWAL_WINDOW_MS) {
    return NextResponse.json({ error: `Your subscription is already active until ${activeUntil.toLocaleDateString("en-ZA")}. You can renew during the last 7 days.`, status: subscription.status, expiresAt: activeUntil }, { status: 400 });
  }

  // The seller is always charged exactly the amount stored on their shop row and
  // shown to them before checkout — no hidden or fabricated price.
  const amountCents = shop.monthlyPriceCents;
  if (amountCents <= 0) return NextResponse.json({ error: "This store has no subscription price configured." }, { status: 500 });
  const provider = getPaymentProvider();
  const providerConfig = provider.config();
  if (!providerConfig.configured) return NextResponse.json({ error: "Subscription payments are not configured yet. No payment will be taken.", missing: providerConfig.missing }, { status: 503 });
  if (!provider.supportsRecurring) return NextResponse.json({ error: "Automatic monthly billing is not enabled on the payment account yet, so a Virtual Store subscription cannot be started. No payment will be taken." }, { status: 503 });
  if (subscription?.autoRenew) return NextResponse.json({ error: "Your subscription already renews automatically. Cancel it first if you want to change it." }, { status: 409 });
  const checkoutCutoff = new Date(now.getTime() - PENDING_CHECKOUT_WINDOW_MS);
  if (subscription && (await prisma.payment.count({ where: { subscriptionId: subscription.id, kind: "INITIAL", status: "PENDING", createdAt: { gt: checkoutCutoff } } })) > 0) {
    return NextResponse.json({ error: "A checkout for this store is already in progress. Complete it or wait a few minutes before trying again." }, { status: 409 });
  }

  // Store the PENDING payment first (server-side price) with an optimistic lock on the
  // subscription row so two concurrent requests cannot both start a checkout.
  let payment;
  try {
    payment = await prisma.$transaction(async (tx) => {
      const sub = subscription ?? (await tx.shopSubscription.create({ data: { shopId: shop.id, status: "PENDING", monthlyPriceCents: amountCents, provider: provider.id } }));
      const created = await tx.payment.create({ data: { userId: session.user.id, purpose: "VIRTUAL_STORE_SUBSCRIPTION", amountCents, currency: "ZAR", status: "PENDING", provider: provider.id, providerRef: newPaymentRef(), kind: "INITIAL", subscriptionId: sub.id } });
      const locked = await tx.shopSubscription.updateMany({ where: { id: sub.id, paymentId: sub.paymentId }, data: { monthlyPriceCents: amountCents, paymentId: created.id, provider: provider.id, ...(activeUntil ? {} : { status: "PENDING" }) } });
      if (locked.count === 0) throw new Error("subscription_changed");
      return created;
    });
  } catch {
    return NextResponse.json({ error: "Your subscription changed while we were starting checkout. Please try again." }, { status: 409 });
  }

  try {
    const checkout = await startProviderCheckout(provider, payment.id, { recurring: true, notifyUrl: providerNotifyUrl(provider.id) });
    return NextResponse.json({ ok: true, status: "PENDING", paymentRequired: true, amountCents, currency: "ZAR", authorizationUrl: checkout.redirectUrl, reference: checkout.reference }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Payment initialization failed. No subscription was started and you were not charged." }, { status: 502 });
  }
}
