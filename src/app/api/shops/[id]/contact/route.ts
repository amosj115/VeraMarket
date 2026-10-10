import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { blockedBetween } from "@/lib/chat-safety";
import { requireVerifiedProfile } from "@/lib/profile-gate";
import { recordShareChat } from "@/lib/share-events";
import { activeShopFilter } from "@/lib/shops";

const schema = z.object({ message: z.string().trim().min(1).max(2000), viaShare: z.boolean().optional() });

// Starts (or continues) a chat with a shop's owner. Requires an account; browsing the shop does not.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Please sign in to chat with this shop." }, { status: 401 });
  const blocked = await requireVerifiedProfile(session.user.id);
  if (blocked) return blocked;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });

  const { id } = await params;
  const shop = await prisma.shop.findFirst({ where: { id, ...activeShopFilter() }, select: { id: true, name: true, ownerId: true } });
  if (!shop) return NextResponse.json({ error: "This shop is no longer available." }, { status: 404 });
  if (shop.ownerId === session.user.id) return NextResponse.json({ error: "You cannot message your own shop." }, { status: 400 });
  if (await blockedBetween(session.user.id, shop.ownerId)) return NextResponse.json({ error: "You cannot message this seller." }, { status: 403 });

  const [userAId, userBId] = [session.user.id, shop.ownerId].sort();
  // The compound unique key cannot match a NULL listingId, so look the general conversation up explicitly.
  const conversation = (await prisma.conversation.findFirst({ where: { userAId, userBId, listingId: null }, select: { id: true } })) ?? (await prisma.conversation.create({ data: { userAId, userBId }, select: { id: true } }));
  await prisma.$transaction([
    prisma.message.create({ data: { conversationId: conversation.id, senderId: session.user.id, body: parsed.data.message } }),
    prisma.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date(), archivedByA: false, archivedByB: false }, select: { id: true } }),
    prisma.notification.create({ data: { userId: shop.ownerId, type: "NEW_MESSAGE", title: "New message", body: `You have a new message about your shop "${shop.name}".`, link: `/messages/${conversation.id}` } }),
  ]);
  if (parsed.data.viaShare) await recordShareChat("SHOP", shop.id, session.user.id).catch(() => null);
  return NextResponse.json({ conversationId: conversation.id }, { status: 201 });
}