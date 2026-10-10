import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { validateImageUpload } from "@/lib/security/image";
import { StorageError, deleteStoredImage, putPublicImage } from "@/lib/storage";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Your session has expired. Please sign in again.", code: "UNAUTHORIZED" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "The upload didn't arrive correctly. Please try again.", code: "INVALID_FORM" }, { status: 400 });
  }
  if (form.get("consent") !== "true") {
    return NextResponse.json({ error: "Please confirm that you are using a real photo of yourself.", code: "CONSENT_REQUIRED" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a photo to upload.", code: "FILE_REQUIRED" }, { status: 400 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateImageUpload(bytes);
  if (!validation.ok) {
    console.warn("[profile-photo] rejected", { code: validation.code, bytes: bytes.length });
    return NextResponse.json({ error: validation.message, code: validation.code }, { status: 400 });
  }

  let url: string;
  try {
    url = await putPublicImage(bytes, validation.image.ext, validation.image.mime);
  } catch (error) {
    if (error instanceof StorageError) {
      console.error("[profile-photo] storage failure", { code: error.code });
      return NextResponse.json({ error: error.message, code: "STORAGE_" + error.code }, { status: 503 });
    }
    console.error("[profile-photo] unexpected upload failure", error instanceof Error ? error.message.slice(0, 300) : "unknown");
    return NextResponse.json({ error: "Something went wrong while saving your photo. Please try again.", code: "SERVER_ERROR" }, { status: 500 });
  }

  const previous = await prisma.user.findUnique({ where: { id: session.user.id }, select: { avatarUrl: true } });
  try {
    // A new photo invalidates any earlier face match.
    await prisma.$transaction([
      prisma.user.update({ where: { id: session.user.id }, data: { avatarUrl: url, profilePhotoConsentAt: new Date(), profileVerification: "NOT_VERIFIED", profileVerifiedAt: null } }),
      prisma.auditLog.create({ data: { actorId: session.user.id, action: "PROFILE_PHOTO_UPLOADED", targetType: "USER", targetId: session.user.id } }),
    ]);
  } catch (error) {
    // Never leave an uploaded image orphaned when the profile row wasn't updated.
    console.error("[profile-photo] profile update failed", error instanceof Error ? error.message.slice(0, 300) : "unknown");
    await deleteStoredImage(url);
    return NextResponse.json({ error: "We couldn't save your photo to your profile. Please try again.", code: "SERVER_ERROR" }, { status: 500 });
  }
  if (previous?.avatarUrl) await deleteStoredImage(previous.avatarUrl);
  return NextResponse.json({ photoUrl: url }, { status: 201 });
}
