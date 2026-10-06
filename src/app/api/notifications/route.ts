import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { serializeNotification } from "@/lib/notifications";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const params = request.nextUrl.searchParams;
  const unreadOnly = params.get("filter") === "unread";
  const limit = Math.min(Math.max(Number.parseInt(params.get("limit") ?? "20", 10) || 20, 1), 50);
  const cursor = params.get("cursor");

  const rows = await prisma.notification.findMany({
    where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    // Cursor is scoped by the userId filter, so a foreign id simply yields no rows.
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const unreadCount = await prisma.notification.count({ where: { userId, readAt: null } });

  return NextResponse.json(
    { items: page.map(serializeNotification), nextCursor: hasMore ? page[page.length - 1].id : null, unreadCount },
    { headers: { "Cache-Control": "no-store" } }
  );
}
