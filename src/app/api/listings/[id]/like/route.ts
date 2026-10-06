import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await prisma.listingLike.findUnique({
    where: { userId_listingId: { userId: session.user.id, listingId: id } },
  });

  if (existing) {
    await prisma.listingLike.delete({ where: { id: existing.id } });
    const count = await prisma.listingLike.count({ where: { listingId: id } });
    return NextResponse.json({ liked: false, count });
  }

  const listing = await prisma.listing.findFirst({ where: { id, status: "ACTIVE" }, select: { id: true } });
  if (!listing) return NextResponse.json({ error: "Listing is no longer available" }, { status: 404 });

  await prisma.listingLike.create({ data: { userId: session.user.id, listingId: id } });
  const count = await prisma.listingLike.count({ where: { listingId: id } });
  return NextResponse.json({ liked: true, count }, { status: 201 });
}