import { createHmac, timingSafeEqual } from "node:crypto";

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_MS = 60_000;

const SEND_URL = "https://sms1.smsmessenger.co.za/app/api/rest/v1/sms/send.json";
const BALANCE_URL = "https://sms1.smsmessenger.co.za/app/api/rest/v1/account/balance.json";

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

export type SmsSendResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: "auth" | "credits" | "invalid_number" | "provider_error" | "network" | "unknown"; status?: number; detail?: string };

export async function sendSms(e164: string, message: string): Promise<SmsSendResult> {
  const email = process.env.SMS_MESSENGER_EMAIL;
  const token = process.env.SMS_MESSENGER_API_TOKEN;
  if (!email || !token) {
    return { ok: false, reason: "auth", detail: "SMS_MESSENGER_EMAIL or SMS_MESSENGER_API_TOKEN not set" };
  }

  try {
    const response = await fetch(SEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        email,
        token,
      },
      body: JSON.stringify({ recipientNumber: toSmsMessengerNumber(e164), message }),
      signal: AbortSignal.timeout(15_000),
    });

    let result: { messageId?: string; error?: string } | null = null;
    const text = await response.text().catch(() => "");
    try {
      result = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON response (e.g., HTML error page)
      console.error("[phone-otp] SMS provider returned non-JSON response", { status: response.status, bodyPreview: text.slice(0, 200) });
      return { ok: false, reason: "provider_error", status: response.status, detail: "Non-JSON response from provider" };
    }

    if (!response.ok) {
      // HTTP error status
      const detail = result?.error ?? text.slice(0, 200);
      console.error("[phone-otp] SMS provider HTTP error", { status: response.status, error: detail });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, reason: "auth", status: response.status, detail };
      }
      if (response.status === 402 || (detail && /credit|balance/i.test(detail))) {
        return { ok: false, reason: "credits", status: response.status, detail };
      }
      if (detail && /invalid|recipient/i.test(detail)) {
        return { ok: false, reason: "invalid_number", status: response.status, detail };
      }
      return { ok: false, reason: "provider_error", status: response.status, detail };
    }

    // SMS Messenger success response: { "messageId": "...", "error": null }
    if (result?.error) {
      console.error("[phone-otp] SMS provider reported error in response body", { error: result.error });
      return { ok: false, reason: "provider_error", detail: result.error };
    }

    if (!result?.messageId) {
      console.error("[phone-otp] SMS provider response missing messageId", { result });
      return { ok: false, reason: "unknown", detail: "Response missing messageId" };
    }

    console.log("[phone-otp] SMS sent successfully", { messageId: result.messageId });
    return { ok: true, messageId: result.messageId };
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      console.error("[phone-otp] SMS provider timeout");
      return { ok: false, reason: "network", detail: "Request timeout" };
    }
    console.error("[phone-otp] SMS provider network error", { error: err instanceof Error ? err.message : String(err) });
    return { ok: false, reason: "network", detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function checkSmsBalance(): Promise<{ ok: true; balance: number } | { ok: false; reason: string }> {
  const email = process.env.SMS_MESSENGER_EMAIL;
  const token = process.env.SMS_MESSENGER_API_TOKEN;
  if (!email || !token) {
    return { ok: false, reason: "SMS_MESSENGER_EMAIL or SMS_MESSENGER_API_TOKEN not set" };
  }

  try {
    const response = await fetch(BALANCE_URL, {
      method: "GET",
      headers: { email, token, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { ok: false, reason: `Balance check failed: ${response.status}` };
    }
    const data = await response.json().catch(() => null);
    if (data && typeof data.creditBalance === "number") {
      return { ok: true, balance: data.creditBalance };
    }
    return { ok: false, reason: "Unexpected balance response format" };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Unknown error" };
  }
}
