import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({ archived: z.boolean() });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const conversation = await prisma.conversation.findUnique({ where: { id }, select: { userAId: true, userBId: true } });
  if (!conversation || (conversation.userAId !== session.user.id && conversation.userBId !== session.user.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const field = conversation.userAId === session.user.id ? "archivedByA" : "archivedByB";
  await prisma.conversation.update({ where: { id }, data: { [field]: parsed.data.archived }, select: { id: true } });
  return NextResponse.json({ archived: parsed.data.archived });
}
