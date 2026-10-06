import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { blockedBetween } from "@/lib/chat-safety";
import { prisma } from "@/lib/prisma";
import { actOnOffer } from "@/lib/offers";

const schema = z.object({ action: z.enum(["ACCEPT", "DECLINE", "COUNTER", "CANCEL", "COMPLETE"]), amountRand: z.coerce.number().positive().max(100_000_000).optional() });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid offer action" }, { status: 400 });
  const { id } = await params;
  const offer = await prisma.offer.findUnique({ where: { id }, select: { buyerId: true, sellerId: true } });
  if (offer && (offer.buyerId === session.user.id || offer.sellerId === session.user.id)) {
    const other = offer.buyerId === session.user.id ? offer.sellerId : offer.buyerId;
    if (await blockedBetween(session.user.id, other)) return NextResponse.json({ error: "You cannot act on offers with this user." }, { status: 403 });
  }
  const result = await actOnOffer({ offerId: id, userId: session.user.id, action: parsed.data.action, amountCents: parsed.data.amountRand === undefined ? undefined : Math.round(parsed.data.amountRand * 100) });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ offerId: result.offerId });
}