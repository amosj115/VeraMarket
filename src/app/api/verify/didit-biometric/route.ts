import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { StorageError, readStoredImage } from "@/lib/storage";
import { detectImageType } from "@/lib/security/image";
import { MAX_ATTEMPTS_PER_DAY, MIN_SECONDS_BETWEEN_ATTEMPTS } from "@/lib/face-verification-shared";
import { verifyBiometric, type DiditBiometricResult, type DiditFailureCode, getDiditProviderStatus, DIDIT_FAILURE_MESSAGES } from "@/lib/didit-biometric";

const MAX_CAPTURE_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const providerStatus = getDiditProviderStatus();
  if (!providerStatus.configured) {
    return NextResponse.json(
      { error: "Biometric verification isn't configured on this server yet.", code: "NOT_CONFIGURED", missing: providerStatus.missing },
      { status: 503 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true, profilePhotoConsentAt: true, profileVerification: true },
  });
  if (!user?.avatarUrl || !user.profilePhotoConsentAt) {
    return NextResponse.json({ error: "Upload your profile photo and accept the photo requirements first.", code: "PHOTO_REQUIRED" }, { status: 400 });
  }
  if (user.profileVerification === "VERIFIED") {
    return NextResponse.json({ error: "You're already verified.", code: "ALREADY_VERIFIED" }, { status: 409 });
  }

  const now = Date.now();
  const recent = await prisma.faceVerificationAttempt.findMany({
    where: { userId, createdAt: { gte: new Date(now - 24 * 60 * 60 * 1000) }, NOT: { failureCode: "PROVIDER_ERROR" } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (recent.length >= MAX_ATTEMPTS_PER_DAY) {
    return NextResponse.json(
      { error: "You've reached today's verification attempt limit. Please try again tomorrow or contact support.", code: "RATE_LIMITED" },
      { status: 429 }
    );
  }
  if (recent[0] && now - recent[0].createdAt.getTime() < MIN_SECONDS_BETWEEN_ATTEMPTS * 1000) {
    return NextResponse.json({ error: "Please wait a few seconds before trying again.", code: "RATE_LIMITED" }, { status: 429 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("user_image");
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_CAPTURE_BYTES) {
    return NextResponse.json({ error: "Camera capture was incomplete or too large. Please try again." }, { status: 400 });
  }
  const liveBytes = new Uint8Array(await file.arrayBuffer());
  const liveDetected = detectImageType(liveBytes);
  if (!liveDetected) return NextResponse.json({ error: "Camera capture was invalid. Please try again." }, { status: 400 });

  let profileBytes: Uint8Array;
  try {
    profileBytes = await readStoredImage(user.avatarUrl);
  } catch (error) {
    if (error instanceof StorageError && error.code === "NOT_FOUND") {
      return NextResponse.json({ error: "Your profile photo must be re-uploaded before verifying.", code: "PHOTO_REQUIRED" }, { status: 400 });
    }
    if (error instanceof StorageError) return NextResponse.json({ error: error.message, code: "STORAGE_" + error.code }, { status: 503 });
    throw error;
  }
  const profileType = detectImageType(profileBytes);
  if (!profileType) return NextResponse.json({ error: "Your profile photo couldn't be read. Please upload it again.", code: "PHOTO_REQUIRED" }, { status: 400 });

  let result: DiditBiometricResult;
  try {
    result = await verifyBiometric(profileBytes, profileType.mime, liveBytes, liveDetected.mime);
  } catch (error) {
    console.error("[didit-biometric] unexpected error", error);
    result = { passed: false, failureCode: "PROVIDER_ERROR" };
  }

  const failureCode: DiditFailureCode | null = result.passed ? null : result.failureCode;
  await prisma.$transaction([
    prisma.faceVerificationAttempt.create({
      data: {
        userId,
        provider: "didit-biometric",
        passed: result.passed,
        failureCode,
      },
    }),
    ...(failureCode === "PROVIDER_ERROR"
      ? []
      : [
          prisma.user.update({
            where: { id: userId },
            data: result.passed ? { profileVerification: "VERIFIED", profileVerifiedAt: new Date() } : { profileVerification: "FAILED", profileVerifiedAt: null },
          }),
        ]),
    prisma.auditLog.create({
      data: {
        actorId: userId,
        action: result.passed ? "DIDIT_BIOMETRIC_VERIFICATION_PASSED" : "DIDIT_BIOMETRIC_VERIFICATION_FAILED",
        targetType: "USER",
        targetId: userId,
        metadata: { provider: "didit-biometric", failureCode, livenessScore: result.livenessScore, faceMatchScore: result.faceMatchScore },
      },
    }),
  ]);

  const used = failureCode === "PROVIDER_ERROR" ? recent.length : recent.length + 1;
  return NextResponse.json(
    {
      passed: result.passed,
      failureCode,
      livenessScore: result.livenessScore,
      faceMatchScore: result.faceMatchScore,
      message: failureCode ? DIDIT_FAILURE_MESSAGES[failureCode] : undefined,
      attemptsRemaining: Math.max(0, MAX_ATTEMPTS_PER_DAY - used),
    },
    { status: result.passed ? 200 : 422 }
  );
}