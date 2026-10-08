import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { integrations } from "@/lib/config";
import { hashOtp, hashesMatch, otpSecret } from "@/lib/phone-otp";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!integrations.smsMessenger.configured) return NextResponse.json({ error: "Phone verification is not configured.", missing: integrations.smsMessenger.missing }, { status: 503 });
  const secret = otpSecret();
  if (!secret) return NextResponse.json({ error: "Phone verification is not configured.", missing: ["AUTH_SECRET"] }, { status: 503 });
  const body = await request.json().catch(() => null) as { code?: string } | null;
  const code = body?.code?.trim() ?? "";
  if (!/^\d{4,10}$/.test(code)) return NextResponse.json({ error: "Enter the verification code." }, { status: 400 });

  const userId = session.user.id;
  const otp = await prisma.otpCode.findFirst({
    where: { userId, purpose: "PHONE_VERIFICATION", consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) return NextResponse.json({ error: "Request a code first." }, { status: 400 });
  if (otp.expiresAt <= new Date()) return NextResponse.json({ error: "That code is invalid or expired." }, { status: 400 });
  if (otp.attempts >= otp.maxAttempts) return NextResponse.json({ error: "Too many attempts. Request a new code." }, { status: 400 });

  // Atomic increment so concurrent guesses cannot exceed the attempt limit.
  const claimed = await prisma.otpCode.updateMany({
    where: { id: otp.id, consumedAt: null, attempts: { lt: otp.maxAttempts } },
    data: { attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return NextResponse.json({ error: "Too many attempts. Request a new code." }, { status: 400 });

  if (!hashesMatch(hashOtp(code, userId, otp.destination, secret), otp.codeHash)) {
    return NextResponse.json({ error: "That code is invalid or expired." }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const consumed = await tx.otpCode.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
      if (consumed.count === 0) throw new Error("OTP_ALREADY_USED");
      await tx.user.update({ where: { id: userId }, data: { phone: otp.destination, phoneVerifiedAt: new Date(), phoneVerification: "VERIFIED" } });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "That phone number is already in use." }, { status: 409 });
    }
    return NextResponse.json({ error: "That code is invalid or expired." }, { status: 400 });
  }
  return NextResponse.json({ verified: true });
}
