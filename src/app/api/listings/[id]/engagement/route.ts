import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const engagementSchema = z.object({ type: z.enum(["VIEW", "SHARE", "CONTACT"]) });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const { id } = await params;
  const parsed = engagementSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid engagement" }, { status: 400 });

  const listing = await prisma.listing.findFirst({
    where: { id, status: "ACTIVE" },
    select: { id: true, sellerId: true },
  });
  if (!listing) return NextResponse.json({ error: "Listing is no longer available" }, { status: 404 });
  if (session?.user?.id === listing.sellerId) return NextResponse.json({ recorded: false });

  const cutoff = new Date(Date.now() - (parsed.data.type === "SHARE" ? 5 : 30) * 60 * 1000);
  const duplicate = session?.user
    ? await prisma.listingEngagement.findFirst({
        where: { listingId: id, userId: session.user.id, type: parsed.data.type, createdAt: { gte: cutoff } },
        select: { id: true },
      })
    : null;

  if (!duplicate) {
    await prisma.$transaction([
      prisma.listingEngagement.create({ data: { listingId: id, userId: session?.user?.id, type: parsed.data.type } }),
      ...(parsed.data.type === "VIEW" ? [prisma.listing.update({ where: { id }, data: { viewCount: { increment: 1 } } })] : []),
    ]);
  }
  return NextResponse.json({ recorded: !duplicate });
}