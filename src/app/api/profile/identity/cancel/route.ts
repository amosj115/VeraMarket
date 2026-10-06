import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// The user closed the verification window. This can only move an open inquiry back to "not verified"; it can never verify anyone.
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const open = await prisma.identityVerification.findFirst({ where: { userId, state: { in: ["CREATED"] } }, orderBy: { createdAt: "desc" } });
  if (!open) return NextResponse.json({ cancelled: false });
  await prisma.$transaction([
    prisma.identityVerification.update({ where: { id: open.id }, data: { state: "CANCELLED", failureCode: "CANCELLED" } }),
    prisma.user.updateMany({ where: { id: userId, profileVerification: "PENDING" }, data: { profileVerification: "NOT_VERIFIED" } }),
    prisma.auditLog.create({ data: { actorId: userId, action: "IDENTITY_VERIFICATION_CANCELLED", targetType: "USER", targetId: userId, metadata: { provider: open.provider, externalId: open.externalId } } }),
  ]);
  return NextResponse.json({ cancelled: true });
}
