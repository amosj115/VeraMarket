import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getNotificationSummary } from "@/lib/notification-groups";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const summary = await getNotificationSummary(session.user.id);
  return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
}
