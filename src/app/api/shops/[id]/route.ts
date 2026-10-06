import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { shopUpdateSchema } from "@/lib/validation/shop";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const shop = await prisma.shop.findFirst({ where: { id, ownerId: session.user.id }, select: { id: true } });
  if (!shop) return NextResponse.json({ error: "Virtual Store not found" }, { status: 404 });
  const parsed = shopUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid store update" }, { status: 400 });
  const payload = { ...parsed.data };
  if (typeof (payload as { isPaused?: boolean }).isPaused === "boolean") {
    (payload as { isPaused: boolean }).isPaused = (payload as { isPaused: boolean }).isPaused;
  }
  await prisma.shop.update({ where: { id }, data: payload });
  return NextResponse.json({ updated: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const shop = await prisma.shop.findFirst({ where: { id, ownerId: session.user.id }, select: { id: true } });
  if (!shop) return NextResponse.json({ error: "Virtual Store not found" }, { status: 404 });
  await prisma.shop.update({ where: { id }, data: { status: "REMOVED" } });
  return NextResponse.json({ removed: true });
}
