import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getPaymentProvider } from "@/lib/payments/registry";
import { processDueRenewals } from "@/lib/payments/service";

// Scheduler-only (CRON_SECRET bearer, same as the other cron routes). Charges Virtual Store
// subscriptions that are due. Subscriptions are claimed atomically, so overlapping runs never double-charge.
function authorised(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: NextRequest) {
  if (!authorised(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const provider = getPaymentProvider();
  if (!provider.config().configured) return NextResponse.json({ skipped: "payment provider not configured" });
  return NextResponse.json(await processDueRenewals(provider));
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
