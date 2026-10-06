import { NextResponse } from "next/server";

// Android App Links. Only served when the real app package and signing fingerprint are configured.
export function GET() {
  const pkg = process.env.ANDROID_APP_PACKAGE;
  const fingerprints = (process.env.ANDROID_APP_SHA256 ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!pkg || fingerprints.length === 0) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json([{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: fingerprints } }]);
}