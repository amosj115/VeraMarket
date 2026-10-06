import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const resetSchema = z.object({ userId: z.string().cuid() });

// Support recovery: clears the attempt history and verification state so the user can start over.
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = resetSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { userId } = parsed.data;
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  await prisma.$transaction([
    prisma.faceVerificationAttempt.deleteMany({ where: { userId } }),
    prisma.user.update({ where: { id: userId }, data: { profileVerification: "NOT_VERIFIED", profileVerifiedAt: null } }),
    prisma.auditLog.create({ data: { actorId: session.user.id, action: "FACE_VERIFICATION_RESET", targetType: "USER", targetId: userId } }),
  ]);
  return NextResponse.json({ reset: true });
}
