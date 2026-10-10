import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireVerifiedProfile } from "@/lib/profile-gate";
import { activeShopFilter } from "@/lib/shops";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ following: false });
  const { id } = await params;
  const follow = await prisma.shopFollower.findUnique({ where: { userId_shopId: { userId: session.user.id, shopId: id } }, select: { id: true } });
  return NextResponse.json({ following: Boolean(follow) });
}

export async function POST(_request: Request, { params }: Context) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const blocked = await requireVerifiedProfile(session.user.id);
  if (blocked) return blocked;
  const shop = await prisma.shop.findFirst({ where: { id, ...activeShopFilter() }, select: { id: true, ownerId: true } });
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  if (shop.ownerId === session.user.id) return NextResponse.json({ error: "You cannot follow your own shop" }, { status: 400 });

  const key = { userId_shopId: { userId: session.user.id, shopId: id } };
  const existing = await prisma.shopFollower.findUnique({ where: key, select: { id: true } });
  if (existing) {
    await prisma.shopFollower.delete({ where: { id: existing.id } });
    return NextResponse.json({ following: false });
  }
  await prisma.shopFollower.upsert({ where: key, update: {}, create: { userId: session.user.id, shopId: id } });
  return NextResponse.json({ following: true });
}
