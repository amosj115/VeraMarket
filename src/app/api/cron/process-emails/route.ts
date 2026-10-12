import { NextRequest, NextResponse } from "next/server";
import { processNotificationQueue } from "@/lib/email";

export async function GET(request: NextRequest) {
  // Vercel Cron requests include the CRON_SECRET in the Authorization header
  // Format: Authorization: Bearer <CRON_SECRET>
  const authHeader = request.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("[cron-emails] CRON_SECRET environment variable is not configured.");
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn(`[cron-emails] Unauthorized cron attempt from ${request.headers.get("x-forwarded-for")}`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processNotificationQueue();
    console.log(`[cron-emails] Successfully processed ${result.processed} notification jobs.`);
    return NextResponse.json({ processed: result.processed }, { status: 200 });
  } catch (error) {
    console.error("[cron-emails] Queue processing failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
