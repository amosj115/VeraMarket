import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { integrations } from "@/lib/config";
import { secureAppUrl } from "@/lib/app-url";
import { createInquiry, resumeInquiry, type PersonaSession } from "@/lib/persona";
import { MAX_ATTEMPTS_PER_DAY, MIN_SECONDS_BETWEEN_ATTEMPTS } from "@/lib/face-verification-shared";

// Starts (or resumes) a Persona inquiry for the signed-in user. The API key never leaves the server;
// the browser only receives a short-lived session token for this one inquiry.
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  if (!integrations.persona.configured) {
    return NextResponse.json({ error: "Identity verification isn't configured on this server yet, so verification can't be completed right now.", code: "NOT_CONFIGURED", missing: integrations.persona.missing }, { status: 503 });
  }
  try { secureAppUrl(); } catch {
    return NextResponse.json({ error: "Identity verification requires the site to be configured with an https:// address.", code: "NOT_CONFIGURED", missing: ["NEXT_PUBLIC_APP_URL", "AUTH_URL"] }, { status: 503 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { profileVerification: true, avatarUrl: true, profilePhotoConsentAt: true } });
  if (!user?.avatarUrl || !user.profilePhotoConsentAt) return NextResponse.json({ error: "Upload your profile photo and accept the photo requirements first.", code: "PHOTO_REQUIRED" }, { status: 400 });
  if (user.profileVerification === "VERIFIED") return NextResponse.json({ error: "You're already verified.", code: "ALREADY_VERIFIED" }, { status: 409 });

  const recent = await prisma.identityVerification.findMany({ where: { userId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }, orderBy: { createdAt: "desc" }, select: { createdAt: true, externalId: true, state: true } });
  const open = recent.find((row) => row.state === "CREATED" || row.state === "PENDING");
  if (!open) {
    if (recent.length >= MAX_ATTEMPTS_PER_DAY) return NextResponse.json({ error: "You've reached today's verification attempt limit. Please try again tomorrow or contact support.", code: "RATE_LIMITED" }, { status: 429 });
    if (recent[0] && Date.now() - recent[0].createdAt.getTime() < MIN_SECONDS_BETWEEN_ATTEMPTS * 1000) return NextResponse.json({ error: "Please wait a few seconds before trying again.", code: "RATE_LIMITED" }, { status: 429 });
  }

  try {
    let started: PersonaSession | null = null;
    if (open) started = await resumeInquiry(open.externalId).catch(() => null);
    if (!started) {
      started = await createInquiry(userId);
      await prisma.$transaction([
        prisma.identityVerification.create({ data: { userId, provider: "persona", externalId: started.inquiryId, state: "CREATED" } }),
        // Closing the abandoned one keeps a single live inquiry per user.
        ...(open ? [prisma.identityVerification.update({ where: { externalId: open.externalId }, data: { state: "EXPIRED", failureCode: "EXPIRED" } })] : []),
        prisma.user.update({ where: { id: userId }, data: { profileVerification: "PENDING" } }),
      ]);
    } else {
      await prisma.user.update({ where: { id: userId }, data: { profileVerification: "PENDING" } });
    }
    return NextResponse.json({ inquiryId: started.inquiryId, sessionToken: started.sessionToken }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[persona] start failed", error);
    return NextResponse.json({ error: "The verification service had a problem. Please try again shortly.", code: "PROVIDER_ERROR" }, { status: 502 });
  }
}
