import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { detectImageType } from "@/lib/security/image";
import { StorageError, deleteStoredImage, putPublicImage } from "@/lib/storage";

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (form?.get("consent") !== "true") {
    return NextResponse.json({ error: "Please confirm that you are using a real photo of yourself." }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Upload a JPEG, PNG or WEBP photo up to 5MB." }, { status: 400 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectImageType(bytes);
  if (!detected) return NextResponse.json({ error: "Only JPEG, PNG and WEBP photos are supported." }, { status: 400 });

  let url: string;
  try {
    url = await putPublicImage(bytes, detected.ext, detected.mime);
  } catch (error) {
    if (error instanceof StorageError) return NextResponse.json({ error: error.message, code: "STORAGE_" + error.code }, { status: 503 });
    throw error;
  }
  const previous = await prisma.user.findUnique({ where: { id: session.user.id }, select: { avatarUrl: true } });

  // A new photo invalidates any earlier face match.
  await prisma.$transaction([
    prisma.user.update({ where: { id: session.user.id }, data: { avatarUrl: url, profilePhotoConsentAt: new Date(), profileVerification: "NOT_VERIFIED", profileVerifiedAt: null } }),
    prisma.auditLog.create({ data: { actorId: session.user.id, action: "PROFILE_PHOTO_UPLOADED", targetType: "USER", targetId: session.user.id } }),
  ]);
  if (previous?.avatarUrl) await deleteStoredImage(previous.avatarUrl);
  return NextResponse.json({ photoUrl: url }, { status: 201 });
}
