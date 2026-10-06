import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const favorite = await prisma.favorite.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!favorite) return NextResponse.json({ error: "Favorite not found" }, { status: 404 });
  await prisma.favorite.delete({ where: { id: favorite.id } });
  return NextResponse.json({ removed: true });
}
