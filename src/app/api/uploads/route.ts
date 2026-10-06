import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { detectImageType } from "@/lib/security/image";
import { StorageError, putPublicImage } from "@/lib/storage";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File must be between 1 byte and 5MB" },
      { status: 400 }
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const detected = detectImageType(bytes);

  if (!detected) {
    return NextResponse.json(
      { error: "Only JPEG, PNG and WEBP images are supported" },
      { status: 400 }
    );
  }

  try {
    const url = await putPublicImage(bytes, detected.ext, detected.mime);
    return NextResponse.json({ url }, { status: 201 });
  } catch (error) {
    if (error instanceof StorageError) return NextResponse.json({ error: error.message, code: "STORAGE_" + error.code }, { status: 503 });
    throw error;
  }
}
