import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { BOOST_PRICING_ZAR_CENTS, integrations } from "@/lib/config";
import { secureAppUrl } from "@/lib/app-url";
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
  if (!integrations.paystack.configured) return NextResponse.json({ error: "Boost payments are not configured. Add Paystack credentials before accepting payment.", missing: integrations.paystack.missing }, { status: 503 });
  let ownerId: string | undefined;
  if (targetType === "LISTING") ownerId = (await prisma.listing.findUnique({ where: { id: targetId }, select: { sellerId: true } }))?.sellerId;
  if (targetType === "SHOP") ownerId = (await prisma.shop.findUnique({ where: { id: targetId }, select: { ownerId: true } }))?.ownerId;
  if (targetType === "SERVICE") ownerId = (await prisma.serviceListing.findUnique({ where: { id: targetId }, select: { providerId: true } }))?.providerId;
  if (targetType === "PROPERTY") ownerId = (await prisma.propertyListing.findUnique({ where: { id: targetId }, select: { ownerId: true } }))?.ownerId;
  if (ownerId !== session.user.id) return NextResponse.json({ error: "You do not own this content" }, { status: 403 });
  const reference = `vera_${randomUUID()}`;
  const callbackUrl = `${secureAppUrl()}/profile/boosts`;
  const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", { method: "POST", headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: session.user.email, amount: amountCents, currency: "ZAR", reference, callback_url: callbackUrl, metadata: { targetType, targetId, duration, userId: session.user.id } }) });
  const paystackData = await paystackResponse.json().catch(() => null);
  if (!paystackResponse.ok || !paystackData?.status || !paystackData?.data?.authorization_url) return NextResponse.json({ error: "Payment initialization failed. No boost was created." }, { status: 502 });
  const boostData: Prisma.BoostCreateInput = { user: { connect: { id: session.user.id } }, targetType, duration, status: "PENDING_PAYMENT", ...(packageId ? { package: { connect: { id: packageId } } } : {}), durationDays, priority, payment: { create: { user: { connect: { id: session.user.id } }, purpose: "BOOST", amountCents, providerRef: reference, status: "PENDING" } } };
  if (targetType === "LISTING") boostData.listing = { connect: { id: targetId } };
  if (targetType === "SHOP") boostData.shop = { connect: { id: targetId } };
  if (targetType === "SERVICE") boostData.service = { connect: { id: targetId } };
  if (targetType === "PROPERTY") boostData.property = { connect: { id: targetId } };
  const boost = await prisma.boost.create({ data: boostData, select: { id: true } });
  return NextResponse.json({ boostId: boost.id, authorizationUrl: paystackData.data.authorization_url, reference }, { status: 201 });
}
