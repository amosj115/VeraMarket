import { blockedBetween } from "@/lib/chat-safety";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireVerifiedProfile } from "@/lib/profile-gate";
import { z } from "zod";
import { recordShareChat } from "@/lib/share-events";

const startConversationSchema = z.object({
  listingId: z.string().cuid(),
  message: z.string().trim().min(1).max(2000),
  viaShare: z.boolean().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conversations = await prisma.conversation.findMany({
    where: {
      OR: [{ userAId: session.user.id }, { userBId: session.user.id }],
    },
    orderBy: { updatedAt: "desc" },
    include: {
      userA: { select: { id: true, displayName: true, username: true, avatarUrl: true } },
      userB: { select: { id: true, displayName: true, username: true, avatarUrl: true } },
      listing: { select: { title: true, slug: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  return NextResponse.json({ conversations });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const blocked = await requireVerifiedProfile(session.user.id);
  if (blocked) return blocked;

  const body = await request.json().catch(() => null);
  const parsed = startConversationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const listing = await prisma.listing.findUnique({
    where: { id: parsed.data.listingId },
  });
  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }
  if (listing.status !== "ACTIVE") {
    return NextResponse.json({ error: "This listing is no longer available." }, { status: 409 });
  }
  if (listing.sellerId === session.user.id) {
    return NextResponse.json(
      { error: "You cannot message yourself about your own listing." },
      { status: 400 }
    );
  }

  if (await blockedBetween(session.user.id, listing.sellerId)) return NextResponse.json({ error: "You cannot message this seller." }, { status: 403 });
  const [userAId, userBId] = [session.user.id, listing.sellerId].sort();

  const conversation = await prisma.conversation.upsert({
    where: {
      userAId_userBId_listingId: {
        userAId,
        userBId,
        listingId: listing.id,
      },
    },
    update: {},
    create: {
      userAId,
      userBId,
      listingId: listing.id,
    },
  });

  const recentContact = await prisma.listingEngagement.findFirst({
    where: { listingId: listing.id, userId: session.user.id, type: "CONTACT", createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } },
    select: { id: true },
  });
  const message = await prisma.$transaction(async (transaction) => {
    const createdMessage = await transaction.message.create({
      data: {
        conversationId: conversation.id,
        senderId: session.user.id,
        body: parsed.data.message,
      },
    });
    if (!recentContact) {
      await transaction.listingEngagement.create({
        data: { listingId: listing.id, userId: session.user.id, type: "CONTACT" },
      });
    }
    return createdMessage;
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  if (parsed.data.viaShare) await recordShareChat("LISTING", listing.id, session.user.id).catch(() => null);

  await prisma.notification.create({
    data: {
      userId: listing.sellerId,
      type: "NEW_MESSAGE",
      title: "New message",
      body: `You have a new message about "${listing.title}".`,
      link: `/messages/${conversation.id}`,
    },
  });

  return NextResponse.json(
    { conversationId: conversation.id, message },
    { status: 201 }
  );
}
