import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const DAY = 24 * 60 * 60 * 1000;
const NOTIFICATION_RETENTION_DAYS = 180;
const SEARCH_RETENTION_DAYS = 7;

// Scheduler-only: same CRON_SECRET bearer auth as /api/boosts/expire.
// GET is what Vercel Cron Jobs send (see vercel.json); POST is kept for external schedulers.
async function handle(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const now = Date.now();
  const [notifications, searches] = await Promise.all([
    prisma.notification.deleteMany({ where: { createdAt: { lt: new Date(now - NOTIFICATION_RETENTION_DAYS * DAY) } } }),
    prisma.searchActivity.deleteMany({ where: { createdAt: { lt: new Date(now - SEARCH_RETENTION_DAYS * DAY) } } }),
  ]);
  return NextResponse.json({ notificationsDeleted: notifications.count, searchesDeleted: searches.count });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
