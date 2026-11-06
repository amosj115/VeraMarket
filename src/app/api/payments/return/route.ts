import { NextRequest, NextResponse } from "next/server";
import { reconcilePayment } from "@/lib/payments/service";
import { secureAppUrl } from "@/lib/app-url";

// Browser return from the hosted checkout. The redirect itself proves nothing: we only use the
// reference to ask the provider server-to-server for the real status, then show the status page.
async function handle(request: NextRequest) {
  const ref = request.nextUrl.searchParams.get("ref") ?? "";
  if (/^[A-Za-z0-9_-]{6,64}$/.test(ref)) await reconcilePayment(ref).catch(() => null);
  const target = ref ? `${secureAppUrl()}/payments/status?ref=${encodeURIComponent(ref)}` : `${secureAppUrl()}/profile`;
  return NextResponse.redirect(target, 303);
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
