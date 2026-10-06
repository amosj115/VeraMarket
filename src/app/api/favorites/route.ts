import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const favoriteSchema = z.object({ targetType: z.enum(["LISTING", "SHOP", "SHOP_PRODUCT", "SERVICE", "PROPERTY"]), targetId: z.string().cuid() });

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = favoriteSchema.safeParse({ targetType: request.nextUrl.searchParams.get("targetType"), targetId: request.nextUrl.searchParams.get("targetId") });
  if (!parsed.success) return NextResponse.json({ error: "Invalid favorite request" }, { status: 400 });
  const { targetType, targetId } = parsed.data;
  const where = targetType === "LISTING" ? { userId: session.user.id, listingId: targetId } : targetType === "SHOP" ? { userId: session.user.id, shopId: targetId } : targetType === "SHOP_PRODUCT" ? { userId: session.user.id, shopProductId: targetId } : targetType === "SERVICE" ? { userId: session.user.id, serviceId: targetId } : { userId: session.user.id, propertyId: targetId };
  const favorite = await prisma.favorite.findFirst({ where });
  return NextResponse.json({ favorited: Boolean(favorite) });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = favoriteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid favorite request" }, { status: 400 });
  const { targetType, targetId } = parsed.data;

  if (targetType === "LISTING") {
    const target = await prisma.listing.findFirst({ where: { id: targetId, status: "ACTIVE" }, select: { id: true } });
    if (!target) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    const existing = await prisma.favorite.findFirst({ where: { userId: session.user.id, listingId: targetId } });
    if (existing) { await prisma.favorite.delete({ where: { id: existing.id } }); return NextResponse.json({ favorited: false }); }
    await prisma.favorite.create({ data: { userId: session.user.id, listingId: targetId } });
  } else if (targetType === "SHOP") {
    const target = await prisma.shop.findFirst({ where: { id: targetId, status: "ACTIVE" }, select: { id: true } });
    if (!target) return NextResponse.json({ error: "Shop not found" }, { status: 404 });
    const existing = await prisma.favorite.findFirst({ where: { userId: session.user.id, shopId: targetId } });
    if (existing) { await prisma.favorite.delete({ where: { id: existing.id } }); return NextResponse.json({ favorited: false }); }
    await prisma.favorite.create({ data: { userId: session.user.id, shopId: targetId } });
  } else if (targetType === "SHOP_PRODUCT") {
    const target = await prisma.shopProduct.findFirst({ where: { id: targetId, shop: { status: "ACTIVE", isPaused: false, subscriptionStatus: "ACTIVE" } }, select: { id: true } });
    if (!target) return NextResponse.json({ error: "Store product not found" }, { status: 404 });
    const existing = await prisma.favorite.findFirst({ where: { userId: session.user.id, shopProductId: targetId } });
    if (existing) { await prisma.favorite.delete({ where: { id: existing.id } }); return NextResponse.json({ favorited: false }); }
    await prisma.favorite.create({ data: { userId: session.user.id, shopProductId: targetId } });
  } else if (targetType === "SERVICE") {
    const target = await prisma.serviceListing.findFirst({ where: { id: targetId, status: "ACTIVE" }, select: { id: true } });
    if (!target) return NextResponse.json({ error: "Service not found" }, { status: 404 });
    const existing = await prisma.favorite.findFirst({ where: { userId: session.user.id, serviceId: targetId } });
    if (existing) { await prisma.favorite.delete({ where: { id: existing.id } }); return NextResponse.json({ favorited: false }); }
    await prisma.favorite.create({ data: { userId: session.user.id, serviceId: targetId } });
  } else {
    const target = await prisma.propertyListing.findFirst({ where: { id: targetId, status: "ACTIVE" }, select: { id: true } });
    if (!target) return NextResponse.json({ error: "Property not found" }, { status: 404 });
    const existing = await prisma.favorite.findFirst({ where: { userId: session.user.id, propertyId: targetId } });
    if (existing) { await prisma.favorite.delete({ where: { id: existing.id } }); return NextResponse.json({ favorited: false }); }
    await prisma.favorite.create({ data: { userId: session.user.id, propertyId: targetId } });
  }
  return NextResponse.json({ favorited: true }, { status: 201 });
}
