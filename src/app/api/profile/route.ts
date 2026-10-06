import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const profileSchema = z.object({ displayName: z.string().trim().min(2).max(60), bio: z.string().trim().max(500), location: z.string().trim().max(120), trendingNotificationsEnabled: z.boolean().optional() });

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { displayName: true, username: true, bio: true, location: true, trendingNotificationsEnabled: true } });
  return user ? NextResponse.json({ user }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = profileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const user = await prisma.user.update({ where: { id: session.user.id }, data: parsed.data, select: { displayName: true, username: true, bio: true, location: true, trendingNotificationsEnabled: true } });
  return NextResponse.json({ user });
}
