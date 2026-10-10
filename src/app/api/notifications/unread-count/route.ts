import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUnreadTotals } from "@/lib/notification-groups";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ count: 0, chat: 0, system: 0 });
  const totals = await getUnreadTotals(session.user.id);
  return NextResponse.json(
    { count: totals.totalUnread, chat: totals.chatUnread, system: totals.systemUnread },
    { headers: { "Cache-Control": "no-store" } }
  );
}
