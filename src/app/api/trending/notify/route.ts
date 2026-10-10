import { NextRequest, NextResponse } from "next/server";
import { notifyTrendingMatches } from "@/lib/trending";

// Scheduler-only: same CRON_SECRET bearer auth as /api/boosts/expire.
// Generates trending notifications for every eligible (ACTIVE) user automatically -
// no user opt-in, no page visit required.
// GET is what Vercel Cron Jobs send; POST is kept for external schedulers.
async function handle(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!expected || authorization !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const notificationsCreated = await notifyTrendingMatches();
  return NextResponse.json({ notificationsCreated });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
