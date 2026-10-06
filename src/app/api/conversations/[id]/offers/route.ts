import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { blockedBetween } from "@/lib/chat-safety";
import { prisma } from "@/lib/prisma";
import { requireVerifiedProfile } from "@/lib/profile-gate";
import { createOffer } from "@/lib/offers";

const schema = z.object({ amountRand: z.coerce.number().positive().max(100_000_000) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const gate = await requireVerifiedProfile(session.user.id);
  if (gate) return gate;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid offer amount." }, { status: 400 });
  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id }, select: { userAId: true, userBId: true } });
  if (conversation) {
    const other = conversation.userAId === session.user.id ? conversation.userBId : conversation.userAId;
    if (await blockedBetween(session.user.id, other)) return NextResponse.json({ error: "You cannot make offers in this conversation." }, { status: 403 });
  }
  const result = await createOffer({ conversationId: id, userId: session.user.id, amountCents: Math.round(parsed.data.amountRand * 100) });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ offerId: result.offerId }, { status: 201 });
}