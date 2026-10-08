import { randomInt } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { integrations } from "@/lib/config";
import { OTP_MAX_ATTEMPTS, OTP_RESEND_MS, OTP_TTL_MS, hashOtp, otpSecret, sendSms } from "@/lib/phone-otp";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!integrations.smsMessenger.configured) return NextResponse.json({ error: "Phone verification is not configured.", missing: integrations.smsMessenger.missing }, { status: 503 });
  const secret = otpSecret();
  if (!secret) return NextResponse.json({ error: "Phone verification is not configured.", missing: ["AUTH_SECRET"] }, { status: 503 });
  const body = await request.json().catch(() => null) as { phone?: string } | null;
  const phone = body?.phone?.trim() ?? "";
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return NextResponse.json({ error: "Use an international phone number, for example +27123456789." }, { status: 400 });

  const userId = session.user.id;
  const recent = await prisma.otpCode.findFirst({
    where: { userId, purpose: "PHONE_VERIFICATION", createdAt: { gt: new Date(Date.now() - OTP_RESEND_MS) } },
    select: { id: true },
  });
  if (recent) return NextResponse.json({ error: "Please wait before requesting another code." }, { status: 429 });

  const owner = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
  if (owner && owner.id !== userId) return NextResponse.json({ error: "That phone number is already in use." }, { status: 409 });

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const [, otp] = await prisma.$transaction([
    prisma.otpCode.updateMany({ where: { userId, purpose: "PHONE_VERIFICATION", consumedAt: null }, data: { consumedAt: new Date() } }),
    prisma.otpCode.create({
      data: {
        userId,
        purpose: "PHONE_VERIFICATION",
        destination: phone,
        codeHash: hashOtp(code, userId, phone, secret),
        maxAttempts: OTP_MAX_ATTEMPTS,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
      select: { id: true },
    }),
  ]);

  const sent = await sendSms(phone, `Your Vera Market verification code is ${code}. It expires in 5 minutes. Do not share it.`);
  if (!sent) {
    await prisma.otpCode.delete({ where: { id: otp.id } }).catch(() => null);
    return NextResponse.json({ error: "The SMS provider could not send a code." }, { status: 502 });
  }
  return NextResponse.json({ sent: true });
}
