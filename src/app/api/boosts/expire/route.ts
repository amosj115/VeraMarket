import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Scheduler-only: same CRON_SECRET bearer auth as the other cron routes.
// GET is what Vercel Cron Jobs send (see vercel.json); POST is kept for external schedulers.
async function handle(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!expected || authorization !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const now = new Date();
  const expired = await prisma.boost.findMany({ where: { status: "ACTIVE", expiresAt: { lte: now } }, select: { id: true, userId: true } });
  if (!expired.length) return NextResponse.json({ expired: 0 });
  await prisma.$transaction([prisma.boost.updateMany({ where: { id: { in: expired.map((boost) => boost.id) } }, data: { status: "EXPIRED" } }), ...expired.map((boost) => prisma.notification.create({ data: { userId: boost.userId, type: "BOOST_EXPIRED", title: "Boost expired", body: "Your paid boost has expired." } }))]);
  return NextResponse.json({ expired: expired.length });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
