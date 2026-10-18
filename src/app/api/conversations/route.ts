import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { publicListingWhere } from "@/lib/listing-visibility";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.listingId || !body?.sellerId) {
    return NextResponse.json({ error: "listingId and sellerId required" }, { status: 400 });
  }

  const listing = await prisma.listing.findFirst({
    where: { id: body.listingId, ...publicListingWhere() },
    include: { seller: { select: { id: true, status: true } } },
  });
  if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  if (listing.sellerId === session.user.id) {
    return NextResponse.json({ error: "Cannot message yourself" }, { status: 400 });
  }
  if (listing.seller.status !== "ACTIVE") {
    return NextResponse.json({ error: "Seller is not available" }, { status: 400 });
  }

  const existing = await prisma.conversation.findFirst({
    where: {
      listingId: listing.id,
      OR: [
        { userAId: session.user.id, userBId: listing.sellerId },
        { userAId: listing.sellerId, userBId: session.user.id },
      ],
    },
  });
  if (existing) {
    return NextResponse.json({ conversationId: existing.id });
  }

  const conversation = await prisma.conversation.create({
    data: {
      userAId: session.user.id,
      userBId: listing.sellerId,
      listingId: listing.id,
    },
  });
  return NextResponse.json({ conversationId: conversation.id });
}
