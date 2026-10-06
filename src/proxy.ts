import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Production only: send any plain-HTTP request (as reported by the TLS-terminating host/load balancer) to the HTTPS origin.
export function proxy(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") return NextResponse.next();
  if (request.headers.get("x-forwarded-proto")?.split(",")[0].trim() !== "http") return NextResponse.next();

  // Local production runs (next start, e2e) have no TLS terminator; real domains never resolve to loopback hosts.
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(request.headers.get("host") ?? "")) return NextResponse.next();

  const canonical = process.env.AUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, canonical && canonical.startsWith("https://") ? canonical : `https://${request.headers.get("host")}`);
  target.protocol = "https:";
  return NextResponse.redirect(target, 308);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
