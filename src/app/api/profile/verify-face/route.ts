import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { StorageError, readStoredImage } from "@/lib/storage";
import { detectImageType } from "@/lib/security/image";
import { MAX_ATTEMPTS_PER_DAY, MIN_SECONDS_BETWEEN_ATTEMPTS, VERIFICATION_PROMPTS, getFaceProvider, type FaceCheckResult, type FaceFailureCode } from "@/lib/face-verification";

const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const provider = getFaceProvider();
  if (!provider) {
    return NextResponse.json({ error: "Face verification is not configured on this server yet, so your profile can't be verified right now.", code: "NOT_CONFIGURED" }, { status: 503 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { avatarUrl: true, profilePhotoConsentAt: true, profileVerification: true } });
  if (!user?.avatarUrl || !user.profilePhotoConsentAt) {
    return NextResponse.json({ error: "Upload your profile photo and accept the photo requirements first.", code: "PHOTO_REQUIRED" }, { status: 400 });
  }

  const now = Date.now();
  const recent = await prisma.faceVerificationAttempt.findMany({
    where: { userId, createdAt: { gte: new Date(now - 24 * 60 * 60 * 1000) }, NOT: { failureCode: "PROVIDER_ERROR" } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (recent.length >= MAX_ATTEMPTS_PER_DAY) {
    return NextResponse.json({ error: "You've reached today's verification attempt limit. Please try again tomorrow or contact support.", code: "RATE_LIMITED" }, { status: 429 });
  }
  if (recent[0] && now - recent[0].createdAt.getTime() < MIN_SECONDS_BETWEEN_ATTEMPTS * 1000) {
    return NextResponse.json({ error: "Please wait a few seconds before trying again.", code: "RATE_LIMITED" }, { status: 429 });
  }

  const form = await request.formData().catch(() => null);
  const captures: { prompt: string; bytes: Uint8Array; mime: string }[] = [];
  for (let i = 0; i < VERIFICATION_PROMPTS.length; i++) {
    const file = form?.get(`capture_${i}`);
    if (!(file instanceof File) || file.size === 0 || file.size > MAX_CAPTURE_BYTES) {
      return NextResponse.json({ error: "Camera capture was incomplete. Please try again." }, { status: 400 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const detected = detectImageType(bytes);
    if (!detected) return NextResponse.json({ error: "Camera capture was invalid. Please try again." }, { status: 400 });
    captures.push({ prompt: VERIFICATION_PROMPTS[i], bytes, mime: detected.mime });
  }

  let photoBytes: Uint8Array;
  try {
    photoBytes = await readStoredImage(user.avatarUrl);
  } catch (error) {
    if (error instanceof StorageError && error.code === "NOT_FOUND") return NextResponse.json({ error: "Your profile photo must be re-uploaded before verifying.", code: "PHOTO_REQUIRED" }, { status: 400 });
    if (error instanceof StorageError) return NextResponse.json({ error: error.message, code: "STORAGE_" + error.code }, { status: 503 });
    throw error;
  }
  const photoType = detectImageType(photoBytes);
  if (!photoType) return NextResponse.json({ error: "Your profile photo couldn't be read. Please upload it again.", code: "PHOTO_REQUIRED" }, { status: 400 });

  let result: FaceCheckResult;
  try {
    result = await provider.verify({ profilePhoto: { bytes: photoBytes, mime: photoType.mime }, captures });
  } catch (error) {
    console.error("[face-verification] provider error", error);
    result = { passed: false, failureCode: "PROVIDER_ERROR" };
  }

  const failureCode: FaceFailureCode | null = result.passed ? null : result.failureCode;
  await prisma.$transaction([
    prisma.faceVerificationAttempt.create({ data: { userId, provider: provider.name, passed: result.passed, failureCode } }),
    // A provider outage must not mark the user as failed.
    ...(failureCode === "PROVIDER_ERROR" ? [] : [prisma.user.update({ where: { id: userId }, data: result.passed ? { profileVerification: "VERIFIED", profileVerifiedAt: new Date() } : { profileVerification: "FAILED", profileVerifiedAt: null } })]),
    prisma.auditLog.create({ data: { actorId: userId, action: result.passed ? "FACE_VERIFICATION_PASSED" : "FACE_VERIFICATION_FAILED", targetType: "USER", targetId: userId, metadata: { provider: provider.name, failureCode } } }),
  ]);

  const used = failureCode === "PROVIDER_ERROR" ? recent.length : recent.length + 1;
  return NextResponse.json({ passed: result.passed, failureCode, attemptsRemaining: Math.max(0, MAX_ATTEMPTS_PER_DAY - used) }, { status: result.passed ? 200 : 422 });
}
