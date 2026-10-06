import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const listing = await prisma.listing.findUnique({ where: { id } });
  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  const existing = await prisma.favorite.findUnique({
    where: { userId_listingId: { userId: session.user.id, listingId: id } },
  });

  if (existing) {
    await prisma.favorite.delete({ where: { id: existing.id } });
    return NextResponse.json({ favorited: false });
  }

  await prisma.favorite.create({
    data: { userId: session.user.id, listingId: id },
  });

  if (listing.sellerId !== session.user.id) {
    await prisma.notification.create({
      data: {
        userId: listing.sellerId,
        type: "LISTING_FAVORITED",
        title: "Someone favorited your listing",
        body: `"${listing.title}" was added to a buyer's favorites.`,
        link: `/listing/${listing.slug}`,
      },
    });
  }

  return NextResponse.json({ favorited: true });
}
