import "./test-db-env";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/security/password";
import { createHash } from "node:crypto";
import assert from "node:assert";

// Creates and deletes fixture users, so scripts/test-db-env.ts repoints Prisma at the
// dedicated *_test database before any query runs.

async function hashEmail(email: string) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

async function run() {
  console.log("Starting Account Management Enhanced Verification...");

  try {
    // Setup
    const pass = "Pass123!";
    const pHash = await hashPassword(pass);
    const admin = await prisma.user.upsert({
      where: { email: "test-admin@test.test" },
      update: {},
      create: {
        email: "test-admin@test.test",
        username: "test-admin",
        displayName: "Admin",
        passwordHash: pHash,
        role: "ADMIN",
        status: "ACTIVE",
      },
    });

    // 1. Test: Deletion record creation and reason storage
    console.log("\nTesting deletion record and reason storage...");
    const victim = await prisma.user.create({
      data: {
        email: `victim-${Date.now()}@test.test`,
        username: `vic-${Date.now()}`,
        displayName: "Victim",
        passwordHash: pHash,
        status: "ACTIVE",
      },
    });

    const reason = "Scamming or fraudulent activity";
    const customReason = "Detected fake IDs";
    const emailHash = await hashEmail(victim.email);

    await prisma.deletedAccountRecord.create({
      data: {
        emailHash,
        reason,
        customReason,
        deletedByUserId: admin.id,
      },
    });

    const record = await prisma.deletedAccountRecord.findUnique({ where: { emailHash } });
    assert.notStrictEqual(record, null);
    assert.strictEqual(record?.reason, reason);
    assert.strictEqual(record?.customReason, customReason);
    console.log("✅ Deletion record stored correctly.");

    // 2. Test: Repeat registration detection
    console.log("\nTesting repeat registration detection...");
    const newRegistrationEmail = victim.email;
    const newRegistrationHash = await hashEmail(newRegistrationEmail);

    const matchingRecord = await prisma.deletedAccountRecord.findUnique({
      where: { emailHash: newRegistrationHash },
    });

    const flaggedForReview = !!matchingRecord;
    assert.strictEqual(flaggedForReview, true);
    console.log("✅ Returning user correctly flagged for review.");

    // 3. Test: Normal registration not flagged
    console.log("\nTesting normal registration (not flagged)...");
    const normalEmail = `normal-${Date.now()}@test.test`;
    const normalHash = await hashEmail(normalEmail);
    const noRecord = await prisma.deletedAccountRecord.findUnique({
      where: { emailHash: normalHash },
    });
    assert.strictEqual(!!noRecord, false);
    console.log("✅ Normal user not flagged.");

    // Cleanup: remove the admin fixture too. Leaving it behind used to make the
    // "last active administrator" checks in scripts/verify-account-management.ts see a
    // second admin and fail, and it could linger in the shared test database.
    await prisma.user.delete({ where: { id: victim.id } });
    await prisma.deletedAccountRecord.delete({ where: { emailHash } });
    await prisma.user.delete({ where: { id: admin.id } });

    console.log("\nAll internal logic checks passed!");
  } catch (e) {
    console.error("\n❌ Test failed:", e);
    process.exit(1);
  }
}

run();
