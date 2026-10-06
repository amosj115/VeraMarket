import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { integrations } from "@/lib/config";

const recentRequests = new Map<string, number>();

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!integrations.twilio.configured) return NextResponse.json({ error: "Phone verification is not configured.", missing: integrations.twilio.missing }, { status: 503 });
  const body = await request.json().catch(() => null) as { phone?: string } | null;
  const phone = body?.phone?.trim() ?? "";
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return NextResponse.json({ error: "Use an international phone number, for example +27123456789." }, { status: 400 });
  const lastRequest = recentRequests.get(session.user.id) ?? 0;
  if (Date.now() - lastRequest < 60_000) return NextResponse.json({ error: "Please wait before requesting another code." }, { status: 429 });
  const form = new URLSearchParams({ To: phone, Channel: "sms" });
  const credentials = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const response = await fetch(`https://verify.twilio.com/v2/Services/${process.env.TWILIO_VERIFY_SERVICE_SID}/Verifications`, { method: "POST", headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  if (!response.ok) return NextResponse.json({ error: "The SMS provider could not send a code." }, { status: 502 });
  await prisma.user.update({ where: { id: session.user.id }, data: { phone } });
  recentRequests.set(session.user.id, Date.now());
  return NextResponse.json({ sent: true });
}
