import { randomInt } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  hashOtp,
  hashesMatch,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_MS,
  OTP_TTL_MS,
  otpSecret,
  sendSms,
  type SmsSendResult,
} from "@/lib/phone-otp";

type LoginOtpRecord = {
  id: string;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
};

type LoginOtpChallengeInput = {
  userId: string;
  destination: string;
  codeHash: string;
  expiresAt: Date;
  now: Date;
};

export type LoginOtpStore = {
  createChallenge(
    input: LoginOtpChallengeInput
  ): Promise<{ kind: "created"; id: string } | { kind: "cooldown"; retryAfterSeconds: number }>;
  findCurrent(userId: string, destination: string): Promise<LoginOtpRecord | null>;
  claimAttempt(id: string, maxAttempts: number, now: Date): Promise<boolean>;
  consume(id: string, now: Date): Promise<boolean>;
  invalidate(id: string, now: Date): Promise<void>;
};

export type LoginOtpDependencies = {
  store: LoginOtpStore;
  sendSms: (destination: string, code: string) => Promise<SmsSendResult>;
  now: () => Date;
};

const loginOtpStore: LoginOtpStore = {
  async createChallenge({ userId, destination, codeHash, expiresAt, now }) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;

      const recent = await tx.otpCode.findFirst({
        where: {
          userId,
          purpose: "LOGIN",
          createdAt: { gt: new Date(now.getTime() - OTP_RESEND_MS) },
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (recent) {
        return {
          kind: "cooldown" as const,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((recent.createdAt.getTime() + OTP_RESEND_MS - now.getTime()) / 1000)
          ),
        };
      }

      await tx.otpCode.updateMany({
        where: { userId, purpose: "LOGIN", consumedAt: null },
        data: { consumedAt: now },
      });
      const otp = await tx.otpCode.create({
        data: {
          userId,
          purpose: "LOGIN",
          destination,
          codeHash,
          maxAttempts: OTP_MAX_ATTEMPTS,
          expiresAt,
        },
        select: { id: true },
      });
      return { kind: "created" as const, id: otp.id };
    });
  },
  async findCurrent(userId, destination) {
    return prisma.otpCode.findFirst({
      where: { userId, destination, purpose: "LOGIN", consumedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, codeHash: true, attempts: true, maxAttempts: true, expiresAt: true },
    });
  },
  async claimAttempt(id, maxAttempts, now) {
    const result = await prisma.otpCode.updateMany({
      where: {
        id,
        purpose: "LOGIN",
        consumedAt: null,
        attempts: { lt: maxAttempts },
        expiresAt: { gt: now },
      },
      data: { attempts: { increment: 1 } },
    });
    return result.count === 1;
  },
  async consume(id, now) {
    const result = await prisma.otpCode.updateMany({
      where: {
        id,
        purpose: "LOGIN",
        consumedAt: null,
        expiresAt: { gt: now },
        attempts: { lte: OTP_MAX_ATTEMPTS },
      },
      data: { consumedAt: now },
    });
    return result.count === 1;
  },
  async invalidate(id, now) {
    await prisma.otpCode.updateMany({
      where: { id, purpose: "LOGIN", consumedAt: null },
      data: { consumedAt: now },
    });
  },
};

const defaultDependencies: LoginOtpDependencies = {
  store: loginOtpStore,
  sendSms: (destination, code) =>
    sendSms(
      destination,
      `Your Vera Market login code is ${code}. It expires in 5 minutes. Do not share it.`
    ),
  now: () => new Date(),
};

export function requiresLoginPhoneOtp(user: {
  phone: string | null;
  phoneVerifiedAt: Date | null;
  phoneVerification: string;
}): boolean {
  return Boolean(user.phoneVerifiedAt || user.phoneVerification === "VERIFIED");
}

export async function requestLoginPhoneOtp(
  userId: string,
  destination: string,
  dependencies: LoginOtpDependencies = defaultDependencies
): Promise<
  | { ok: true; retryAfterSeconds: number }
  | { ok: false; reason: "invalid_destination" | "secret_missing" | "cooldown" | "delivery_failed"; retryAfterSeconds?: number }
> {
  if (!/^\+[1-9]\d{7,14}$/.test(destination)) return { ok: false, reason: "invalid_destination" };
  const secret = otpSecret();
  if (!secret) return { ok: false, reason: "secret_missing" };

  const now = dependencies.now();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const challenge = await dependencies.store.createChallenge({
    userId,
    destination,
    codeHash: hashOtp(code, userId, destination, secret),
    expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    now,
  });
  if (challenge.kind === "cooldown") {
    return { ok: false, reason: "cooldown", retryAfterSeconds: challenge.retryAfterSeconds };
  }

  const result = await dependencies.sendSms(destination, code);
  if (!result.ok) {
    await dependencies.store.invalidate(challenge.id, dependencies.now());
    return {
      ok: false,
      reason: "delivery_failed",
      retryAfterSeconds: Math.ceil(OTP_RESEND_MS / 1000),
    };
  }

  return { ok: true, retryAfterSeconds: Math.ceil(OTP_RESEND_MS / 1000) };
}

export async function verifyLoginPhoneOtp(
  userId: string,
  destination: string,
  code: string,
  store: LoginOtpStore = loginOtpStore,
  now = new Date()
): Promise<"verified" | "invalid" | "expired" | "too_many_attempts" | "not_configured"> {
  if (!/^\d{6}$/.test(code)) return "invalid";
  const secret = otpSecret();
  if (!secret) return "not_configured";

  const otp = await store.findCurrent(userId, destination);
  if (!otp) return "invalid";
  if (otp.expiresAt <= now) return "expired";
  if (otp.attempts >= otp.maxAttempts) return "too_many_attempts";

  const claimed = await store.claimAttempt(otp.id, otp.maxAttempts, now);
  if (!claimed) return "too_many_attempts";
  if (!hashesMatch(hashOtp(code, userId, destination, secret), otp.codeHash)) return "invalid";

  return (await store.consume(otp.id, now)) ? "verified" : "invalid";
}
