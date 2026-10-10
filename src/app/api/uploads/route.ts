import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { validateImageUpload } from "@/lib/security/image";
import { StorageError, putPublicImage } from "@/lib/storage";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided", code: "FILE_REQUIRED" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateImageUpload(bytes);
  if (!validation.ok) {
    console.warn("[uploads] rejected", { code: validation.code, bytes: bytes.length });
    return NextResponse.json({ error: validation.message, code: validation.code }, { status: 400 });
  }

  try {
    const url = await putPublicImage(bytes, validation.image.ext, validation.image.mime);
    return NextResponse.json({ url }, { status: 201 });
  } catch (error) {
    if (error instanceof StorageError) {
      console.error("[uploads] storage failure", { code: error.code });
      return NextResponse.json({ error: error.message, code: "STORAGE_" + error.code }, { status: 503 });
    }
    console.error("[uploads] unexpected upload failure", error instanceof Error ? error.message.slice(0, 300) : "unknown");
    return NextResponse.json({ error: "Something went wrong while saving your image. Please try again.", code: "SERVER_ERROR" }, { status: 500 });
  }
}
