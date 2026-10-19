import { NextRequest, NextResponse } from "next/server";
import { authenticateCredentials } from "@/lib/credentials";
import { integrations } from "@/lib/config";
import { requestLoginPhoneOtp, requiresLoginPhoneOtp } from "@/lib/login-phone-otp";
import { loginSchema } from "@/lib/validation/auth";

function maskPhone(phone: string): string {
  return phone.replace(/\d(?=\d{3})/g, "•");
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  }

  const user = await authenticateCredentials({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (!user) {
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
  }

  if (!requiresLoginPhoneOtp(user)) {
    return NextResponse.json({ requiresVerification: false });
  }
  if (!user.phone) {
    return NextResponse.json(
      { error: "This account's verified phone number is unavailable. Contact support to restore access." },
      { status: 409 }
    );
  }

  const provider = integrations.smsMessenger;
  if (!provider.configured) {
    return NextResponse.json(
      {
        error: "SMS verification is not configured.",
        missing: provider.missing,
      },
      { status: 503 }
    );
  }

  const result = await requestLoginPhoneOtp(user.id, user.phone);
  if (!result.ok) {
    if (result.reason === "cooldown") {
      return NextResponse.json(
        { error: "Please wait before requesting another code.", retryAfterSeconds: result.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } }
      );
    }
    if (result.reason === "secret_missing") {
      return NextResponse.json(
        { error: "Login verification is not configured.", missing: ["AUTH_SECRET"] },
        { status: 503 }
      );
    }
    if (result.reason === "invalid_destination") {
      return NextResponse.json({ error: "The verified phone number is invalid." }, { status: 409 });
    }
    return NextResponse.json(
      {
        error: "The SMS provider could not send your code. Try again later.",
        retryAfterSeconds: result.retryAfterSeconds,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    requiresVerification: true,
    destination: maskPhone(user.phone),
    retryAfterSeconds: result.retryAfterSeconds,
  });
}
