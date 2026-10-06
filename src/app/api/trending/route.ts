import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getTrendingPage } from "@/lib/trending";

export async function GET(request: NextRequest) {
  const rawOffset = Number(request.nextUrl.searchParams.get("offset") ?? "0");
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.min(1000, Math.floor(rawOffset))) : 0;
  const session = await auth();
  const page = await getTrendingPage(session?.user?.id, offset);
  return NextResponse.json(page);
}