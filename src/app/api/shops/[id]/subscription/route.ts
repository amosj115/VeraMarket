import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const shop = await prisma.shop.findFirst({
    where: { id, ownerId: session.user.id },
    include: { subscription: true },
  });

  if (!shop) return NextResponse.json({ error: "Virtual Store not found" }, { status: 404 });

  const { action } = (await request.json().catch(() => ({ action: "activate" }))) as { action?: string };

  if (action === "pause") {
    await prisma.shop.update({ where: { id }, data: { isPaused: true, subscriptionStatus: "CANCELLED" } });
    return NextResponse.json({ ok: true, paused: true });
  }

  if (action === "reactivate") {
    await prisma.shop.update({ where: { id }, data: { isPaused: false, subscriptionStatus: "PENDING" } });
    return NextResponse.json({ ok: true, paused: false });
  }

  const payment = await prisma.payment.create({
    data: {
      userId: session.user.id,
      purpose: "VIRTUAL_STORE_SUBSCRIPTION",
      amountCents: shop.monthlyPriceCents,
      currency: "ZAR",
      status: "PENDING",
      provider: "paystack",
      providerRef: `virtual-store-${shop.id}-${Date.now()}`,
    },
  });

  await prisma.shop.update({
    where: { id },
    data: {
      isPaused: false,
      subscriptionStatus: "PENDING",
    },
  });

  if (shop.subscription) {
    await prisma.shopSubscription.update({
      where: { id: shop.subscription.id },
      data: {
        status: "PENDING",
        monthlyPriceCents: shop.monthlyPriceCents,
        paymentId: payment.id,
        renewsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  } else {
    await prisma.shopSubscription.create({
      data: {
        shopId: shop.id,
        status: "PENDING",
        monthlyPriceCents: shop.monthlyPriceCents,
        paymentId: payment.id,
        renewsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }

  return NextResponse.json({ ok: true, status: "PENDING", paymentRequired: true, amountCents: shop.monthlyPriceCents, currency: "ZAR" });
}
