import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_MS,
  OTP_TTL_MS,
  sendSms,
} from "../../src/lib/phone-otp";
import {
  requestLoginPhoneOtp,
  verifyLoginPhoneOtp,
  type LoginOtpStore,
} from "../../src/lib/login-phone-otp";
const originalSecret = process.env.AUTH_SECRET;
after(() => {
  if (originalSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = originalSecret;
});

type StoredOtp = {
  id: string;
  userId: string;
  destination: string;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  createdAt: Date;
  consumedAt: Date | null;
};

class MemoryLoginOtpStore implements LoginOtpStore {
  readonly rows: StoredOtp[] = [];
  private nextId = 1;

  async createChallenge(input: Parameters<LoginOtpStore["createChallenge"]>[0]) {
    const recent = this.rows
      .filter(
        (row) =>
          row.userId === input.userId &&
          row.createdAt.getTime() > input.now.getTime() - OTP_RESEND_MS
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (recent) {
      return {
        kind: "cooldown" as const,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((recent.createdAt.getTime() + OTP_RESEND_MS - input.now.getTime()) / 1000)
        ),
      };
    }

    for (const row of this.rows) {
      if (row.userId === input.userId && !row.consumedAt) {
        row.consumedAt = input.now;
      }
    }
    const id = String(this.nextId++);
    this.rows.push({
      ...input,
      id,
      attempts: 0,
      maxAttempts: OTP_MAX_ATTEMPTS,
      createdAt: input.now,
      consumedAt: null,
    });
    return { kind: "created" as const, id };
  }

  async findCurrent(userId: string, destination: string) {
    const row = [...this.rows]
      .reverse()
      .find(
        (candidate) =>
          candidate.userId === userId &&
          candidate.destination === destination &&
          candidate.consumedAt === null
      );
    return row
      ? {
          id: row.id,
          codeHash: row.codeHash,
          attempts: row.attempts,
          maxAttempts: row.maxAttempts,
          expiresAt: row.expiresAt,
        }
      : null;
  }

  async claimAttempt(id: string, maxAttempts: number, now: Date) {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (
      !row ||
      row.consumedAt ||
      row.expiresAt <= now ||
      row.attempts >= maxAttempts
    ) {
      return false;
    }
    row.attempts += 1;
    return true;
  }

  async consume(id: string, now: Date) {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row || row.consumedAt || row.expiresAt <= now) return false;
    row.consumedAt = now;
    return true;
  }

  async invalidate(id: string, now: Date) {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (row && !row.consumedAt) row.consumedAt = now;
  }
}

function setTestSecret() {
  process.env.AUTH_SECRET = "login-otp-test-secret";
}

test("issues an SMS login code and verifies it once", async () => {
  setTestSecret();
  const store = new MemoryLoginOtpStore();
  const now = new Date("2026-10-14T12:00:00.000Z");
  let deliveredCode = "";
  const result = await requestLoginPhoneOtp("user-1", "+27123456789", {
    store,
    now: () => now,
    sendSms: async (_destination, code) => {
      deliveredCode = code;
      return { ok: true, messageId: "sms-test" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(deliveredCode.length, 6);
  assert.equal(await verifyLoginPhoneOtp("user-1", "+27123456789", deliveredCode, store, now), "verified");
  assert.equal(await verifyLoginPhoneOtp("user-1", "+27123456789", deliveredCode, store, now), "invalid");
});

test("rejects incorrect, expired, and over-attempt login codes", async () => {
  setTestSecret();
  const store = new MemoryLoginOtpStore();
  const now = new Date("2026-10-14T12:00:00.000Z");
  let deliveredCode = "";
  await requestLoginPhoneOtp("user-2", "+27123456789", {
    store,
    now: () => now,
    sendSms: async (_destination, code) => {
      deliveredCode = code;
      return { ok: true, messageId: "sms-test" };
    },
  });

  const incorrectCode = deliveredCode === "000000" ? "000001" : "000000";
  for (let attempt = 0; attempt < OTP_MAX_ATTEMPTS; attempt += 1) {
    assert.equal(await verifyLoginPhoneOtp("user-2", "+27123456789", incorrectCode, store, now), "invalid");
  }
  assert.equal(await verifyLoginPhoneOtp("user-2", "+27123456789", deliveredCode, store, now), "too_many_attempts");
  assert.equal(
    await verifyLoginPhoneOtp(
      "user-2",
      "+27123456789",
      deliveredCode,
      store,
      new Date(now.getTime() + OTP_TTL_MS + 1)
    ),
    "expired"
  );
});

test("applies a resend cooldown to SMS login codes", async () => {
  setTestSecret();
  const store = new MemoryLoginOtpStore();
  const now = new Date("2026-10-14T12:00:00.000Z");
  let smsDeliveries = 0;
  const dependencies = {
    store,
    now: () => now,
    sendSms: async () => {
      smsDeliveries += 1;
      return { ok: true as const, messageId: "sms-test" };
    },
  };

  assert.equal((await requestLoginPhoneOtp("user-3", "+27123456789", dependencies)).ok, true);
  const retry = await requestLoginPhoneOtp("user-3", "+27123456789", dependencies);
  assert.deepEqual(retry, {
    ok: false,
    reason: "cooldown",
    retryAfterSeconds: Math.ceil(OTP_RESEND_MS / 1000),
  });
  assert.equal(smsDeliveries, 1);
});

test("invalidates an undelivered challenge and retains the cooldown", async () => {
  setTestSecret();
  const store = new MemoryLoginOtpStore();
  const now = new Date("2026-10-14T12:00:00.000Z");
  const result = await requestLoginPhoneOtp("user-4", "+27123456789", {
    store,
    now: () => now,
    sendSms: async () => ({ ok: false, reason: "unknown" }),
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "delivery_failed",
    retryAfterSeconds: Math.ceil(OTP_RESEND_MS / 1000),
  });
  assert.equal(store.rows[0]?.consumedAt?.getTime(), now.getTime());
  assert.equal(await verifyLoginPhoneOtp("user-4", "+27123456789", "123456", store, now), "invalid");
});

test("redacts a login code echoed by SMS provider errors", async () => {
  const envKeys = ["SMS_MESSENGER_EMAIL", "SMS_MESSENGER_API_TOKEN"] as const;
  const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const logged: string[] = [];
  process.env.SMS_MESSENGER_EMAIL = "test@example.invalid";
  process.env.SMS_MESSENGER_API_TOKEN = "test-token";
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "Provider rejected code 123456" }), { status: 400 });
  console.error = (...values: unknown[]) => logged.push(values.join(" "));

  try {
    const result = await sendSms("+27123456789", "Your Vera Market login code is 123456.");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.detail?.includes("123456"), false);
    assert.equal(logged.join(" ").includes("123456"), false);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
    for (const key of envKeys) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("retains the existing SMS Messenger delivery contract", async () => {
  const envKeys = ["SMS_MESSENGER_EMAIL", "SMS_MESSENGER_API_TOKEN"] as const;
  const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const sentBodies: { recipientNumber?: string; message?: string }[] = [];
  process.env.SMS_MESSENGER_EMAIL = "test@example.invalid";
  process.env.SMS_MESSENGER_API_TOKEN = "test-token";
  globalThis.fetch = async (_input, init) => {
    sentBodies.push(JSON.parse(String(init?.body)) as { recipientNumber?: string; message?: string });
    return new Response(JSON.stringify({ messageId: "sms-test", error: null }), { status: 200 });
  };

  try {
    assert.deepEqual(await sendSms("+27123456789", "Your Vera Market login code is 123456."), {
      ok: true,
      messageId: "sms-test",
    });
    const sentBody = sentBodies[0];
    assert.ok(sentBody);
    assert.equal(sentBody.recipientNumber, "27123456789");
    assert.equal(sentBody.message, "Your Vera Market login code is 123456.");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
