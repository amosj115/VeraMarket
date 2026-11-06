import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { BOOST_PRICING_ZAR_CENTS } from "@/lib/config";
import { getPaymentProvider } from "@/lib/payments/registry";
import { newPaymentRef, providerNotifyUrl, startProviderCheckout } from "@/lib/payments/service";
import { boostSchema } from "@/lib/validation/boost";
import { durationEnum, ensureBoostPackages } from "@/lib/boosts";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = boostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid boost request" }, { status: 400 });
  const { targetType, targetId } = parsed.data;
  let duration = parsed.data.duration ?? "SEVEN_DAYS";
  let amountCents: number = BOOST_PRICING_ZAR_CENTS[duration];
  let durationDays: number | undefined;
  let priority = 1;
  let packageId: string | undefined;
  if (parsed.data.packageId) {
    await ensureBoostPackages();
    const pack = await prisma.boostPackage.findFirst({ where: { id: parsed.data.packageId, enabled: true } });
    if (!pack) return NextResponse.json({ error: "That boost package is not available." }, { status: 404 });
    if (pack.priceCents <= 0) return NextResponse.json({ error: "This boost package has no price configured yet, so it cannot be sold. Set a price in admin config before offering it." }, { status: 400 });
    amountCents = pack.priceCents; durationDays = pack.durationDays; priority = pack.priority; packageId = pack.id; duration = durationEnum(pack.durationDays);
  }
  if (amountCents <= 0) return NextResponse.json({ error: "This boost has no price configured yet. Set a price before accepting payment." }, { status: 400 });
  const provider = getPaymentProvider();
  const providerConfig = provider.config();
  if (!providerConfig.configured) return NextResponse.json({ error: "Boost payments are not configured yet. No payment will be taken.", missing: providerConfig.missing }, { status: 503 });
  let ownerId: string | undefined;
  if (targetType === "LISTING") {
    const listing = await prisma.listing.findUnique({ where: { id: targetId }, select: { sellerId: true, status: true } });
    ownerId = listing?.sellerId;
    if (listing && listing.sellerId === session.user.id && listing.status !== "ACTIVE") return NextResponse.json({ error: "Only active, approved listings can be boosted." }, { status: 409 });
  }
  if (targetType === "SHOP") ownerId = (await prisma.shop.findUnique({ where: { id: targetId }, select: { ownerId: true } }))?.ownerId;
  if (targetType === "SERVICE") ownerId = (await prisma.serviceListing.findUnique({ where: { id: targetId }, select: { providerId: true } }))?.providerId;
  if (targetType === "PROPERTY") ownerId = (await prisma.propertyListing.findUnique({ where: { id: targetId }, select: { ownerId: true } }))?.ownerId;
  if (ownerId !== session.user.id) return NextResponse.json({ error: "You do not own this content" }, { status: 403 });
  const reference = newPaymentRef();
  const boostData: Prisma.BoostCreateInput = { user: { connect: { id: session.user.id } }, targetType, duration, status: "PENDING_PAYMENT", ...(packageId ? { package: { connect: { id: packageId } } } : {}), durationDays, priority, payment: { create: { user: { connect: { id: session.user.id } }, purpose: "BOOST", amountCents, currency: "ZAR", provider: provider.id, providerRef: reference, status: "PENDING" } } };
  if (targetType === "LISTING") boostData.listing = { connect: { id: targetId } };
  if (targetType === "SHOP") boostData.shop = { connect: { id: targetId } };
  if (targetType === "SERVICE") boostData.service = { connect: { id: targetId } };
  if (targetType === "PROPERTY") boostData.property = { connect: { id: targetId } };
  const boost = await prisma.boost.create({ data: boostData, select: { id: true, paymentId: true } });
  try {
    const checkout = await startProviderCheckout(provider, boost.paymentId!, { recurring: false, notifyUrl: providerNotifyUrl(provider.id) });
    return NextResponse.json({ boostId: boost.id, authorizationUrl: checkout.redirectUrl, reference }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Payment initialization failed. No boost was activated and you were not charged." }, { status: 502 });
  }
}
