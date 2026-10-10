import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { listingUpdateSchema } from "@/lib/validation/listing-update";
import { dropListingMatchNotifications, notifyPriceChange, notifyWishlistStatus, safeNotify } from "@/lib/notifications";

async function ownedListing(id: string, userId: string) { return prisma.listing.findFirst({ where: { id, sellerId: userId } }); }

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await ownedListing(id, session.user.id);
  if (!existing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  const parsed = listingUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid update" }, { status: 400 });
  const { priceRand, ...rest } = parsed.data;
  const listing = await prisma.listing.update({ where: { id }, data: { ...rest, ...(priceRand === undefined ? {} : { priceCents: Math.round(priceRand * 100) }) }, select: { id: true, slug: true, status: true, priceCents: true } });
  if (listing.priceCents !== existing.priceCents) await safeNotify(() => notifyPriceChange(listing.id, existing.priceCents, listing.priceCents));
  if (listing.status !== existing.status) {
    // The listing left the public catalogue: stop match notifications from still
    // promising it as "just listed". Event history (followers, price, wishlist) stays.
    await safeNotify(() => dropListingMatchNotifications(id));
    if (listing.status === "SOLD" || listing.status === "REMOVED") await safeNotify(() => notifyWishlistStatus(listing.id, listing.status as "SOLD" | "REMOVED"));
  }
  return NextResponse.json({ listing: { id: listing.id, slug: listing.slug, status: listing.status } });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await ownedListing(id, session.user.id);
  if (!existing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  await prisma.listing.update({ where: { id }, data: { status: "REMOVED" } });
  await safeNotify(() => notifyWishlistStatus(id, "REMOVED"));
  await safeNotify(() => dropListingMatchNotifications(id));
  return NextResponse.json({ removed: true });
}
