import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { publicListingWhere } from "@/lib/listing-visibility";
import { blockedBetween, paymentRisk, SAFETY_REMINDER } from "@/lib/chat-safety";
import { requireVerifiedProfile } from "@/lib/profile-gate";

export const createConversationSchema = z.object({
  listingId: z.string({ error: "Listing ID required." }).trim().min(1, "Listing ID required."),
  sellerId: z.string().trim().min(1).optional(),
  message: z.string().trim().min(1).max(2000).optional(),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createConversationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  const body = parsed.data;

  const listing = await prisma.listing.findFirst({
    where: { id: body.listingId, ...publicListingWhere() },
    include: { seller: { select: { id: true, status: true } } },
  });
  if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  if (body.sellerId && body.sellerId !== listing.sellerId) {
    return NextResponse.json({ error: "Listing seller is invalid." }, { status: 400 });
  }
  if (listing.sellerId === session.user.id) {
    return NextResponse.json({ error: "Cannot message yourself" }, { status: 400 });
  }
  if (listing.seller.status !== "ACTIVE") {
    return NextResponse.json({ error: "Seller is not available" }, { status: 400 });
  }
  if (await blockedBetween(session.user.id, listing.sellerId)) {
    return NextResponse.json({ error: "You cannot message this seller.", code: "BLOCKED" }, { status: 403 });
  }
  if (body.message) {
    const gate = await requireVerifiedProfile(session.user.id);
    if (gate) return gate;
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
  const conversation = existing ?? await prisma.conversation.create({
    data: { userAId: session.user.id, userBId: listing.sellerId, listingId: listing.id },
  });

  if (body.message) {
    await prisma.$transaction([
      prisma.message.create({
        data: { conversationId: conversation.id, senderId: session.user.id, body: body.message },
      }),
      ...(paymentRisk(body.message)
        ? [prisma.message.create({ data: { conversationId: conversation.id, senderId: session.user.id, body: SAFETY_REMINDER, kind: "SYSTEM" } })]
        : []),
      prisma.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date(), archivedByA: false, archivedByB: false },
      }),
      prisma.notification.create({
        data: {
          userId: listing.sellerId,
          type: "NEW_MESSAGE",
          title: "New message",
          body: "You have a new message.",
          link: `/messages/${conversation.id}`,
        },
      }),
    ]);
  }

  return NextResponse.json({ conversationId: conversation.id });
}
