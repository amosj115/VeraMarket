import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { integrations } from "@/lib/config";
import { MAX_ATTEMPTS_PER_DAY } from "@/lib/face-verification";
import { profileVerificationEnforced } from "@/lib/profile-gate";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [user, attempts, latestIdentity, identityAttempts] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id }, select: { profileVerification: true, avatarUrl: true, profilePhotoConsentAt: true, displayName: true, bio: true, location: true } }),
    prisma.faceVerificationAttempt.count({ where: { userId: session.user.id, createdAt: { gte: since }, NOT: { failureCode: "PROVIDER_ERROR" } } }),
    prisma.identityVerification.findFirst({ where: { userId: session.user.id }, orderBy: { createdAt: "desc" }, select: { state: true, failureCode: true } }),
    prisma.identityVerification.count({ where: { userId: session.user.id, createdAt: { gte: since } } }),
  ]);
  const provider = integrations.persona.configured ? "persona" : integrations.faceVerification.configured ? "http" : null;
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(
    {
      status: user.profileVerification,
      photoUrl: user.avatarUrl,
      consented: Boolean(user.profilePhotoConsentAt),
      displayName: user.displayName,
      bio: user.bio ?? "",
      location: user.location ?? "",
      providerConfigured: provider !== null,
      provider,
      identityState: latestIdentity?.state ?? null,
      identityFailure: latestIdentity?.failureCode ?? null,
      enforced: profileVerificationEnforced(),
      attemptsRemaining: Math.max(0, MAX_ATTEMPTS_PER_DAY - (provider === "persona" ? identityAttempts : attempts)),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
