import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ id: string }> };

// Every query filters by the session user, so another user's id is indistinguishable from a missing one.
export async function PATCH(_request: NextRequest, { params }: Context) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await prisma.notification.findFirst({ where: { id, userId: session.user.id }, select: { id: true, readAt: true } });
  if (!existing) return NextResponse.json({ error: "Notification not found" }, { status: 404 });
  if (!existing.readAt) await prisma.notification.updateMany({ where: { id, userId: session.user.id }, data: { readAt: new Date() } });
  return NextResponse.json({ read: true });
}

export async function DELETE(_request: NextRequest, { params }: Context) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const result = await prisma.notification.deleteMany({ where: { id, userId: session.user.id } });
  if (!result.count) return NextResponse.json({ error: "Notification not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
