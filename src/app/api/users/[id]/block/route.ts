import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (id === session.user.id) return NextResponse.json({ error: "You cannot block yourself" }, { status: 400 });
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  await prisma.userBlock.upsert({ where: { blockerId_blockedId: { blockerId: session.user.id, blockedId: id } }, update: {}, create: { blockerId: session.user.id, blockedId: id } });
  return NextResponse.json({ blocked: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await prisma.userBlock.deleteMany({ where: { blockerId: session.user.id, blockedId: id } });
  return NextResponse.json({ blocked: false });
}