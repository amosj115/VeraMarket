import "./db-guard";
import { PrismaClient } from "@prisma/client";
import { getTrendingPage } from "@/lib/trending";
import { getNotificationSummary, getUnreadTotals } from "@/lib/notification-groups";

// Performance baseline tool for the *_test database (db-guard enforced).
// Run after scripts/_perf-seed.ts. Measures wall-clock timings of the hottest
// data paths and captures EXPLAIN ANALYZE output for the queries whose index
// coverage was called into question. Prints a compact JSON report.

const prisma = new PrismaClient();
const QUERIES = ["phone", "laptop", "couch", "camera"];

async function timeIt<T>(label: string, fn: () => Promise<T>): Promise<{ label: string; ms: number; result: T }> {
  const start = performance.now();
  const result = await fn();
  return { label, ms: Math.round(performance.now() - start), result };
}

function bytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

async function main() {
  const report: Record<string, unknown> = {};

  const user = await prisma.user.findFirst({ where: { username: { startsWith: "perftest_user_0" } }, select: { id: true } });
  const conv = await prisma.conversation.findFirst({ where: { userAId: user!.id }, select: { id: true } });

  // 1. Trending pipeline (homepage + /trending + /api/trending).
  const t1 = await timeIt("getTrendingPage(cold)", () => getTrendingPage());
  const t2 = await timeIt("getTrendingPage(warm)", () => getTrendingPage());
  const t3 = await timeIt("getTrendingPage(user)", () => getTrendingPage(user!.id));
  report.trending = { coldMs: t1.ms, warmMs: t2.ms, userMs: t3.ms, items: t1.result.items.length };

  // 2. Notification badge/summary (polled by the bell).
  const u1 = await timeIt("getUnreadTotals", () => getUnreadTotals(user!.id));
  const u2 = await timeIt("getNotificationSummary", () => getNotificationSummary(user!.id));
  report.notifications = { unreadTotalsMs: u1.ms, summaryMs: u2.ms, totalUnread: u1.result.totalUnread };

  // 3. Marketplace search: the two queries /api/listings runs per page.
  const where = { status: "ACTIVE" as const, OR: [{ title: { contains: "phone", mode: "insensitive" as const } }, { description: { contains: "phone", mode: "insensitive" as const } }] };
  const m1 = await timeIt("listings.findMany(ILIKE)", () => prisma.listing.findMany({ where, orderBy: { createdAt: "desc" as const }, skip: 0, take: 24, include: { images: { take: 1, orderBy: { sortOrder: "asc" as const } }, category: { select: { name: true, slug: true } } } }));
  const m2 = await timeIt("listings.count(ILIKE)", () => prisma.listing.count({ where }));
  report.marketplace = { findManyMs: m1.ms, countMs: m2.ms, rows: m1.result.length, total: m2.result, payloadBytes: bytes(m1.result) };

  // 4. Unbounded public list endpoints.
  const s1 = await timeIt("services.findMany(all)", () => prisma.serviceListing.findMany({ where: { status: "ACTIVE" }, orderBy: { createdAt: "desc" }, include: { category: true } }));
  const s2 = await timeIt("properties.findMany(all)", () => prisma.propertyListing.findMany({ where: { status: "ACTIVE" }, orderBy: { createdAt: "desc" } }));
  const s3 = await timeIt("conversations.findMany(user)", () => prisma.conversation.findMany({ where: { OR: [{ userAId: user!.id }, { userBId: user!.id }] }, include: { userA: true, userB: true, listing: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } } }));
  report.listEndpoints = {
    servicesMs: s1.ms, servicesBytes: bytes(s1.result), servicesRows: s1.result.length,
    propertiesMs: s2.ms, propertiesBytes: bytes(s2.result), propertiesRows: s2.result.length,
    conversationsMs: s3.ms, conversationsBytes: bytes(s3.result), conversationsRows: s3.result.length,
  };

  // 5. Message history (polled per open conversation).
  const msg = await timeIt("messages.findMany(conversation)", () => prisma.message.findMany({ where: { conversationId: conv!.id }, orderBy: { createdAt: "asc" }, include: { sender: { select: { id: true, displayName: true, username: true } } } }));
  report.messages = { ms: msg.ms, rows: msg.result.length, payloadBytes: bytes(msg.result) };

  // 6. EXPLAIN ANALYZE for index-coverage questions (SQL text mirrors the Prisma queries).
  const explain = async (sql: string) => {
    try {
      const rows = await prisma.$queryRawUnsafe<{ ["QUERY PLAN"]: string }[]>(sql);
      return rows.map((r) => r["QUERY PLAN"]);
    } catch (e) {
      return [`error: ${(e as Error).message.slice(0, 120)}`];
    }
  };
  report.explain = {
    favoriteGroupBy: await explain(`EXPLAIN ANALYZE SELECT "listingId", COUNT(*) FROM "Favorite" WHERE "listingId" IS NOT NULL AND "createdAt" >= NOW() - INTERVAL '1 day' GROUP BY "listingId" ORDER BY COUNT(*) DESC LIMIT 300`),
    unreadMessages: await explain(`EXPLAIN ANALYZE SELECT COUNT(*) FROM "Message" m JOIN "Conversation" c ON c."id" = m."conversationId" WHERE m."senderId" <> '${user!.id}' AND m."readAt" IS NULL AND (c."userAId" = '${user!.id}' OR c."userBId" = '${user!.id}')`),
    ilikeSearch: await explain(`EXPLAIN ANALYZE SELECT id FROM "Listing" WHERE status = 'ACTIVE' AND (title ILIKE '%phone%' OR description ILIKE '%phone%') ORDER BY "createdAt" DESC LIMIT 24`),
    notificationPurge: await explain(`EXPLAIN ANALYZE SELECT id FROM "Notification" WHERE "createdAt" < NOW() - INTERVAL '180 days'`),
  };

  // Keep the queries referenced so tree-shaking never drops them from the plan.
  void QUERIES;

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
