import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { integrations } from "@/lib/config";
import { secureAppUrl } from "@/lib/app-url";

const RENEWAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Actions: "subscribe" (start or renew the R59/month subscription through Paystack),
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

  const { action } = (await request.json().catch(() => ({ action: "subscribe" }))) as { action?: string };

  if (action === "pause") {
    await prisma.shop.update({ where: { id }, data: { isPaused: true } });
    return NextResponse.json({ ok: true, paused: true });
  }

  if (action === "reactivate") {
    await prisma.shop.update({ where: { id }, data: { isPaused: false } });
    return NextResponse.json({ ok: true, paused: false });
  }

  if (action !== "subscribe" && action !== "activate") return NextResponse.json({ error: "Unknown action" }, { status: 400 });

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
  if (!integrations.paystack.configured) return NextResponse.json({ error: "Subscription payments are not configured. Add Paystack credentials before accepting payment.", missing: integrations.paystack.missing }, { status: 503 });

  const reference = `vera_${randomUUID()}`;
  const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: session.user.email, amount: amountCents, currency: "ZAR", reference, callback_url: `${secureAppUrl()}/profile/shops`, metadata: { purpose: "VIRTUAL_STORE_SUBSCRIPTION", shopId: shop.id, userId: session.user.id } }),
  });
  const paystackData = await paystackResponse.json().catch(() => null);
  if (!paystackResponse.ok || !paystackData?.status || !paystackData?.data?.authorization_url) {
    return NextResponse.json({ error: "Payment initialization failed. No subscription was started." }, { status: 502 });
  }

  // Only now that Paystack accepted the charge request do we record the pending
  // payment; the webhook is what turns it into an active subscription. A renewal
  // keeps the current ACTIVE status so visibility never drops while paying.
  const payment = await prisma.payment.create({
    data: { userId: session.user.id, purpose: "VIRTUAL_STORE_SUBSCRIPTION", amountCents, currency: "ZAR", status: "PENDING", provider: "paystack", providerRef: reference },
  });
  if (subscription) {
    await prisma.shopSubscription.update({ where: { id: subscription.id }, data: { ...(activeUntil ? {} : { status: "PENDING" }), monthlyPriceCents: amountCents, paymentId: payment.id } });
  } else {
    await prisma.shopSubscription.create({ data: { shopId: shop.id, status: "PENDING", monthlyPriceCents: amountCents, paymentId: payment.id } });
  }

  return NextResponse.json({ ok: true, status: "PENDING", paymentRequired: true, amountCents, currency: "ZAR", authorizationUrl: paystackData.data.authorization_url, reference }, { status: 201 });
}
