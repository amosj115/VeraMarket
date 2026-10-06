import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireVerifiedProfile } from "@/lib/profile-gate";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ following: false });
  const { id } = await params;
  const follow = await prisma.sellerFollow.findUnique({ where: { followerId_sellerId: { followerId: session.user.id, sellerId: id } }, select: { id: true } });
  return NextResponse.json({ following: Boolean(follow) });
}

export async function POST(_request: Request, { params }: Context) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (id === session.user.id) return NextResponse.json({ error: "You cannot follow yourself" }, { status: 400 });
  const blocked = await requireVerifiedProfile(session.user.id);
  if (blocked) return blocked;
  const seller = await prisma.user.findFirst({ where: { id, status: "ACTIVE" }, select: { id: true } });
  if (!seller) return NextResponse.json({ error: "Seller not found" }, { status: 404 });

  const key = { followerId_sellerId: { followerId: session.user.id, sellerId: id } };
  const existing = await prisma.sellerFollow.findUnique({ where: key, select: { id: true } });
  if (existing) {
    await prisma.sellerFollow.delete({ where: { id: existing.id } });
    return NextResponse.json({ following: false });
  }
  await prisma.sellerFollow.upsert({ where: key, update: {}, create: { followerId: session.user.id, sellerId: id } });
  return NextResponse.json({ following: true });
}
