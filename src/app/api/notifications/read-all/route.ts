import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Clears every unread badge at once: system notifications and unread chat messages,
// so the grouped view and the messages page both end up at zero.
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const now = new Date();
  const [notifications, messages] = await prisma.$transaction([
    prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: now } }),
    prisma.message.updateMany({
      where: { senderId: { not: userId }, readAt: null, conversation: { OR: [{ userAId: userId }, { userBId: userId }] } },
      data: { readAt: now },
    }),
  ]);
  return NextResponse.json({ updated: notifications.count, messagesUpdated: messages.count });
}
