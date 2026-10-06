import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveShareTarget } from "@/lib/share-events";

const schema = z.object({
  targetType: z.enum(["LISTING", "SHOP", "SERVICE", "PROPERTY", "PROFILE"]),
  targetId: z.string().cuid(),
  kind: z.enum(["SHARE", "LINK_VIEW"]),
  channel: z.string().trim().max(20).regex(/^[a-z]+$/).optional(),
});

// Public on purpose: shared links are opened by visitors without accounts. Only public, active content can be recorded.
export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { targetType, targetId, kind, channel } = parsed.data;
  const session = await auth();
  const target = await resolveShareTarget(targetType, targetId);
  if (!target) return NextResponse.json({ recorded: false }, { status: 404 });
  if (session?.user?.id === target.ownerId) return NextResponse.json({ recorded: false });

  await prisma.shareEvent.create({ data: { targetType, targetId, ownerId: target.ownerId, kind, channel, userId: session?.user?.id } });
  if (kind === "SHARE" && targetType === "LISTING") {
    await prisma.listingEngagement.create({ data: { listingId: targetId, userId: session?.user?.id, type: "SHARE" } });
  }
  return NextResponse.json({ recorded: true });
}