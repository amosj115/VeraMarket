import { NextResponse } from "next/server";

// iOS Universal Links. Only served when the real app ID (TEAMID.bundleid) is configured.
export function GET() {
  const appId = process.env.IOS_APP_ID;
  if (!appId) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json({ applinks: { details: [{ appIDs: [appId], components: [{ "/": "/shop/*" }, { "/": "/listing/*" }, { "/": "/services/*" }, { "/": "/real-estate/*" }, { "/": "/@*" }] }] } });
}