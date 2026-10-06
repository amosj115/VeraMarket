import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { integrations } from "@/lib/config";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!integrations.twilio.configured) return NextResponse.json({ error: "Phone verification is not configured.", missing: integrations.twilio.missing }, { status: 503 });
  const body = await request.json().catch(() => null) as { code?: string } | null;
  const code = body?.code?.trim() ?? "";
  if (!/^\d{4,10}$/.test(code)) return NextResponse.json({ error: "Enter the verification code." }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { phone: true } });
  if (!user?.phone) return NextResponse.json({ error: "Request a code first." }, { status: 400 });
  const form = new URLSearchParams({ To: user.phone, Code: code });
  const credentials = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const response = await fetch(`https://verify.twilio.com/v2/Services/${process.env.TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`, { method: "POST", headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  const result = await response.json().catch(() => null) as { status?: string } | null;
  if (!response.ok || result?.status !== "approved") return NextResponse.json({ error: "That code is invalid or expired." }, { status: 400 });
  await prisma.user.update({ where: { id: session.user.id }, data: { phoneVerifiedAt: new Date(), phoneVerification: "VERIFIED" } });
  return NextResponse.json({ verified: true });
}
