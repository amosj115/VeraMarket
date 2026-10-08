import { createHmac, timingSafeEqual } from "node:crypto";

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_MS = 60_000;

const SEND_URL = "https://sms1.smsmessenger.co.za/app/api/rest/v1/sms/send.json";

export function otpSecret(): string | null {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || null;
}

export function hashOtp(code: string, userId: string, destination: string, secret: string): string {
  return createHmac("sha256", secret).update(`${userId}:${destination}:${code}`).digest("hex");
}

export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

// "+27821234567" -> "27821234567"
export function toSmsMessengerNumber(e164: string): string {
  return e164.replace(/^\+/, "");
}

export async function sendSms(e164: string, message: string): Promise<boolean> {
  try {
    const response = await fetch(SEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        email: process.env.SMS_MESSENGER_EMAIL ?? "",
        token: process.env.SMS_MESSENGER_API_TOKEN ?? "",
      },
      body: JSON.stringify({ recipientNumber: toSmsMessengerNumber(e164), message }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.error("[phone-otp] SMS provider rejected request", response.status);
      return false;
    }
    const result = (await response.json().catch(() => null)) as { success?: boolean; error?: unknown } | null;
    if (result && (result.success === false || result.error)) {
      console.error("[phone-otp] SMS provider reported failure");
      return false;
    }
    return true;
  } catch {
    console.error("[phone-otp] SMS provider unreachable");
    return false;
  }
}
