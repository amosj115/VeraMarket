import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

function signatureMatches(rawBody: string, signature: string | null) {
  if (!signature || !process.env.PAYSTACK_WEBHOOK_SECRET) return false;
  const expected = createHmac("sha512", process.env.PAYSTACK_WEBHOOK_SECRET).update(rawBody).digest("hex");
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}

const durationDays = { ONE_DAY: 1, THREE_DAYS: 3, SEVEN_DAYS: 7, THIRTY_DAYS: 30 } as const;

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!signatureMatches(rawBody, request.headers.get("x-paystack-signature"))) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  const event = JSON.parse(rawBody) as { event?: string; data?: { reference?: string; status?: string } };
  const reference = event.data?.reference;
  if (!reference) return NextResponse.json({ received: true });
  const payment = await prisma.payment.findUnique({ where: { providerRef: reference }, include: { boost: true, proSubscription: true, shopSubscription: true } });
  if (!payment) return NextResponse.json({ received: true });
  if (event.event === "charge.success" && payment.status !== "SUCCEEDED" && payment.proSubscription) {
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await prisma.$transaction([prisma.payment.update({ where: { id: payment.id }, data: { status: "SUCCEEDED", verifiedAt: new Date() } }), prisma.proSubscription.update({ where: { id: payment.proSubscription.id }, data: { status: "ACTIVE", currentPeriodEnd: periodEnd } }), prisma.notification.create({ data: { userId: payment.userId, type: "PRO_UPDATE", title: "Vera Pro is active", body: "Your Vera Pro subscription is active for 30 days.", link: "/pro" } })]);
  } else if (event.event === "charge.success" && payment.status !== "SUCCEEDED" && payment.shopSubscription) {
    // R59/month Virtual Store subscription. The period starts now, or extends the
    // current one when the seller renewed early; the store becomes publicly visible
    // and its listings pick up the 25% baseline boost from this moment.
    const now = new Date();
    const sub = payment.shopSubscription;
    const stillRunning = sub.expiresAt && sub.expiresAt > now;
    const startsAt = sub.startsAt ?? now;
    const expiresAt = new Date((stillRunning ? sub.expiresAt!.getTime() : now.getTime()) + 30 * 24 * 60 * 60 * 1000);
    await prisma.$transaction([
      prisma.payment.update({ where: { id: payment.id }, data: { status: "SUCCEEDED", verifiedAt: now } }),
      prisma.shopSubscription.update({ where: { id: sub.id }, data: { status: "ACTIVE", startsAt, expiresAt, renewsAt: expiresAt } }),
      prisma.shop.update({ where: { id: sub.shopId }, data: { subscriptionStatus: "ACTIVE" } }),
      prisma.notification.create({ data: { userId: payment.userId, type: "STORE_SUBSCRIPTION_ACTIVE", title: "Virtual Store subscription active", body: `Your Virtual Store subscription is active until ${expiresAt.toLocaleDateString("en-ZA")}.`, link: "/profile/shops" } }),
    ]);
  } else if (event.event === "charge.success" && payment.status !== "SUCCEEDED" && payment.boost) {
    const startsAt = new Date();
    const expiresAt = new Date(startsAt.getTime() + (payment.boost.durationDays ?? durationDays[payment.boost.duration]) * 24 * 60 * 60 * 1000);
    await prisma.$transaction([prisma.payment.update({ where: { id: payment.id }, data: { status: "SUCCEEDED", verifiedAt: new Date() } }), prisma.boost.update({ where: { id: payment.boost.id }, data: { status: "ACTIVE", startsAt, expiresAt } }), prisma.notification.create({ data: { userId: payment.userId, type: "BOOST_ACTIVATED", title: "Boost activated", body: "Your paid boost is now active." } })]);
  } else if (["charge.failed", "charge.reversed"].includes(event.event ?? "") && payment.status === "PENDING") {
    await prisma.$transaction([prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } }), ...(payment.boost ? [prisma.boost.update({ where: { id: payment.boost.id }, data: { status: "CANCELLED" } })] : []), ...(payment.proSubscription ? [prisma.proSubscription.update({ where: { id: payment.proSubscription.id }, data: { status: "CANCELLED" } })] : [])]);
  }
  return NextResponse.json({ received: true });
}
