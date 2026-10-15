import { NextRequest, NextResponse } from "next/server";
import { getTrendingFeedPage } from "@/lib/trending-feed";
import { parseTrendingCursor } from "@/lib/trending-cursor";

export async function GET(request: NextRequest) {
  const rawCursor = request.nextUrl.searchParams.get("cursor");
  const cursor = rawCursor === null ? undefined : parseTrendingCursor(rawCursor);
  if (cursor === null) {
    return NextResponse.json({ error: "Invalid page cursor." }, { status: 400 });
  }

  try {
    return NextResponse.json(await getTrendingFeedPage(cursor));
  } catch {
    return NextResponse.json({ error: "Trending listings could not be loaded." }, { status: 500 });
  }
}
