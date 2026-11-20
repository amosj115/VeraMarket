import "../../scripts/test-db-env";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomBytes } from "node:crypto";
import { prisma } from "../../src/lib/prisma";
import { authenticateCredentials } from "../../src/lib/credentials";
import { hashPassword } from "../../src/lib/security/password";
import { hashOtp, OTP_MAX_ATTEMPTS, OTP_TTL_MS } from "../../src/lib/phone-otp";

const run = randomBytes(4).toString("hex");
const userIds: string[] = [];
process.env.AUTH_SECRET = "password-login-test-secret";
process.env.SMS_MESSENGER_EMAIL = "test@example.invalid";
process.env.SMS_MESSENGER_API_TOKEN = "test-only-token";

async function makeUser(opts: { phoneVerified?: boolean } = {}) {
  const n = userIds.length + 1;
  const phone = opts.phoneVerified ? `+27${String(820000000 + n)}` : null;
  const user = await prisma.user.create({
    data: {
      email: `password_${run}_${n}@example.test`,
      displayName: `Password ${n}`,
      username: `password_${run}_${n}`,
      passwordHash: await hashPassword("CorrectPassword1"),
      emailVerifiedAt: new Date(),
      phone,
      phoneVerifiedAt: opts.phoneVerified ? new Date() : null,
      phoneVerification: opts.phoneVerified ? "VERIFIED" : "NOT_VERIFIED",
    },
  });
  userIds.push(user.id);
  return user;
}

after(async () => {
  await prisma.otpCode.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

test("correct password logs in existing verified and unverified users without login SMS OTP", async () => {
  const verified = await makeUser({ phoneVerified: true });
  const unverified = await makeUser();

  for (const user of [verified, unverified]) {
    const authenticated = await authenticateCredentials({
      email: user.email,
      password: "CorrectPassword1",
    });
    assert.equal(authenticated?.id, user.id);
  }

  const loginOtpCount = await prisma.otpCode.count({
    where: { userId: { in: userIds }, purpose: "LOGIN" },
  });
  assert.equal(loginOtpCount, 0);
});

test("incorrect password is rejected for verified and unverified users", async () => {
  const verified = await makeUser({ phoneVerified: true });
  const unverified = await makeUser();

  assert.equal(await authenticateCredentials({ email: verified.email, password: "WrongPassword1" }), null);
  assert.equal(await authenticateCredentials({ email: unverified.email, password: "WrongPassword1" }), null);
});

test("onboarding phone verification remains saved across subsequent password authentication", async () => {
  const user = await makeUser();
  const phone = "+27839990001";
  const code = "123456";
  const now = new Date();
  const otp = await prisma.otpCode.create({
    data: {
      userId: user.id,
      purpose: "PHONE_VERIFICATION",
      destination: phone,
      codeHash: hashOtp(code, user.id, phone, process.env.AUTH_SECRET!),
      maxAttempts: OTP_MAX_ATTEMPTS,
      expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    },
  });

  await prisma.$transaction(async (tx) => {
    const consumed = await tx.otpCode.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: now },
    });
    assert.equal(consumed.count, 1);
    await tx.user.update({
      where: { id: user.id },
      data: {
        phone,
        phoneVerifiedAt: now,
        phoneVerification: "VERIFIED",
      },
    });
  });

  const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(saved.phone, phone);
  assert.equal(saved.phoneVerification, "VERIFIED");
  assert.ok(saved.phoneVerifiedAt);

  assert.equal((await authenticateCredentials({ email: saved.email, password: "CorrectPassword1" }))?.id, user.id);
  assert.equal(await prisma.otpCode.count({ where: { id: otp.id, purpose: "PHONE_VERIFICATION", consumedAt: { not: null } } }), 1);
  assert.equal(await prisma.otpCode.count({ where: { userId: user.id, purpose: "LOGIN" } }), 0);
});

test("existing verified users retain verification and login without changing it", async () => {
  const user = await makeUser({ phoneVerified: true });
  const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

  assert.equal((await authenticateCredentials({ email: before.email, password: "CorrectPassword1" }))?.id, user.id);

  const afterLogin = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(afterLogin.phone, before.phone);
  assert.equal(afterLogin.phoneVerifiedAt?.getTime(), before.phoneVerifiedAt?.getTime());
  assert.equal(afterLogin.phoneVerification, "VERIFIED");
  assert.equal(await prisma.otpCode.count({ where: { userId: user.id, purpose: "LOGIN" } }), 0);
});
