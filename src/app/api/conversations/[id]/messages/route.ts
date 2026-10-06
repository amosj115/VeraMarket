import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireVerifiedProfile } from "@/lib/profile-gate";
import { z } from "zod";
import { blockedBetween, paymentRisk, SAFETY_REMINDER } from "@/lib/chat-safety";

const sendMessageSchema = z.object({ body: z.string().trim().min(1).max(2000) });

async function assertParticipant(conversationId: string, userId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  });
  if (!conversation) return null;
  if (conversation.userAId !== userId && conversation.userBId !== userId) return null;
  return conversation;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const conversation = await assertParticipant(id, session.user.id);
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const messages = await prisma.message.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
    include: { sender: { select: { id: true, displayName: true, username: true } } },
  });

  await prisma.message.updateMany({
    where: { conversationId: id, senderId: { not: session.user.id }, readAt: null },
    data: { readAt: new Date() },
  });

  return NextResponse.json({ messages });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const conversation = await assertParticipant(id, session.user.id);
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const blocked = await requireVerifiedProfile(session.user.id);
  if (blocked) return blocked;

  const body = await request.json().catch(() => null);
  const parsed = sendMessageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const recipient = conversation.userAId === session.user.id ? conversation.userBId : conversation.userAId;
  const block = await blockedBetween(session.user.id, recipient);
  if (block) return NextResponse.json({ error: block.blockedByMe ? "You blocked this user. Unblock them to send messages." : "You can no longer message this user.", code: "BLOCKED" }, { status: 403 });

  const message = await prisma.message.create({
    data: {
      conversationId: id,
      senderId: session.user.id,
      body: parsed.data.body,
    },
  });

  const risky = paymentRisk(parsed.data.body);
  if (risky) await prisma.message.create({ data: { conversationId: id, senderId: session.user.id, body: SAFETY_REMINDER, kind: "SYSTEM" } });
  await prisma.conversation.update({ where: { id }, data: { updatedAt: new Date(), archivedByA: false, archivedByB: false } });

  const recipientId =
    conversation.userAId === session.user.id ? conversation.userBId : conversation.userAId;

  await prisma.notification.create({
    data: {
      userId: recipientId,
      type: "NEW_MESSAGE",
      title: "New message",
      body: "You have a new message.",
      link: `/messages/${id}`,
    },
  });

  return NextResponse.json({ message, safetyWarning: risky ? SAFETY_REMINDER : null }, { status: 201 });
}
