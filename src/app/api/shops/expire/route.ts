import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Scheduler-only: same CRON_SECRET bearer auth as the other cron routes.
// Flips R59 subscriptions that ran past their expiry to EXPIRED so the denormalised
// shop column stays truthful. Public queries already gate on expiresAt, so benefits
// stop at the expiry moment even if this job is late.
// GET is what Vercel Cron Jobs send (see vercel.json); POST is kept for external schedulers.
async function handle(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!expected || authorization !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const now = new Date();
  const expired = await prisma.shopSubscription.findMany({
    where: { status: "ACTIVE", expiresAt: { lte: now } },
    select: { id: true, shopId: true, shop: { select: { ownerId: true, name: true } } },
  });
  if (!expired.length) return NextResponse.json({ expired: 0 });
  await prisma.$transaction([
    prisma.shopSubscription.updateMany({ where: { id: { in: expired.map((row) => row.id) } }, data: { status: "EXPIRED" } }),
    prisma.shop.updateMany({ where: { id: { in: expired.map((row) => row.shopId) } }, data: { subscriptionStatus: "EXPIRED" } }),
    ...expired.map((row) => prisma.notification.create({ data: { userId: row.shop.ownerId, type: "SHOP_UPDATE", title: "Virtual Store subscription expired", body: `Your Virtual Store ${row.shop.name} is no longer public. Renew to bring it back.`, link: "/profile/shops", dedupeKey: `shop-subscription-expired:${row.shopId}:${row.id}` } })),
  ]);
  return NextResponse.json({ expired: expired.length });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
