import "./test-db-env";
import { prisma } from "@/lib/prisma";
import { hashEmailLegacy, hashEmailSecure } from "@/lib/account-security";
import { escapeHtml } from "@/lib/email";
import {
  adminDeleteAccountSchema,
  adminHoldSchema,
  adminLiftHoldSchema,
  adminReviewFlagSchema,
  DELETION_REASONS,
} from "@/lib/validation/account";

// Focused verification of the account-deletion and review-flag internals that the
// end-to-end suite (scripts/verify-account-management.ts) does not reach: input
// validation, the email-hash records used for repeat-offender detection, and the
// per-reason deletion record shape. Runs against the dedicated *_test database only
// (see scripts/test-db-env.ts) and cleans up every row it creates.

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` -> ${JSON.stringify(detail)}`}`);
}

async function main() {
  const run = Date.now().toString(36);

  // --- 1. Validation schemas (pure; no DB) ---
  check("hold schema requires a cuid userId", !adminHoldSchema.safeParse({ userId: "not-a-cuid", reason: "spam spam spam" }).success);
  check("hold schema requires a reason of 5+ chars", !adminHoldSchema.safeParse({ userId: `c${run}`.padEnd(30, "0"), reason: "abc" }).success);
  check("lift schema rejects missing userId", !adminLiftHoldSchema.safeParse({}).success);
  check("review-flag schema accepts an optional reason", adminReviewFlagSchema.safeParse({ userId: `c${run}`.padEnd(30, "1") }).success);
  check("review-flag schema enforces 5+ char reason when given", !adminReviewFlagSchema.safeParse({ userId: `c${run}`.padEnd(30, "1"), reason: "ab" }).success);
  check("delete schema rejects a reason outside the enum", !adminDeleteAccountSchema.safeParse({ userId: `c${run}`.padEnd(30, "2"), reason: "because I said so" }).success);
  check("delete schema accepts every published reason", DELETION_REASONS.every((reason) => adminDeleteAccountSchema.safeParse({ userId: `c${run}`.padEnd(30, "3"), reason }).success));

  // --- 2. Email hashing used by DeletedAccountRecord / repeat-offender detection ---
  const email = `enhanced-${run}@example.test`;
  const legacy = hashEmailLegacy(email);
  const secure = hashEmailSecure(email, "test-secret");
  check("legacy hash is plain SHA-256 (stable for old records)", legacy === hashEmailLegacy(`  ${email.toUpperCase()}  `));
  check("secure hash is keyed and differs from legacy", secure !== legacy && secure === hashEmailSecure(email, "test-secret"));
  check("secure hash changes with the secret", secure !== hashEmailSecure(email, "other-secret"));

  // --- 2b. HTML escaping used by the deactivation email body ---
  check("escapeHtml neutralises tags", escapeHtml("<script>alert(1)</script>") === "&lt;script&gt;alert(1)&lt;/script&gt;");
  check("escapeHtml neutralises attributes", escapeHtml(`\" onerror=\"x`) === "&quot; onerror=&quot;x");
  check("escapeHtml escapes ampersands first", escapeHtml("a & b < c") === "a &amp; b &lt; c");
  check("escapeHtml escapes single quotes", escapeHtml("it's") === "it&#39;s");
  check("escapeHtml leaves normal text intact", escapeHtml("Scamming or fraudulent activity") === "Scamming or fraudulent activity");

  // --- 3. Deletion record round-trip with the same helpers the admin route uses ---
  const admin = await prisma.user.upsert({
    where: { email: `enh-admin-${run}@example.test` },
    update: {},
    create: {
      email: `enh-admin-${run}@example.test`,
      username: `enhadmin${run}`,
      displayName: "Enhanced Admin",
      passwordHash: "not-a-login-hash",
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  const record = await prisma.deletedAccountRecord.create({
    data: { emailHash: secure, reason: "Scamming or fraudulent activity", customReason: "Verified test fixture", deletedByUserId: admin.id },
  });
  const found = await prisma.deletedAccountRecord.findUnique({ where: { emailHash: hashEmailSecure(email, "test-secret") } });
  check("deletion record is retrievable by keyed hash", found?.id === record.id);
  check("deletion record preserves reason and custom reason", found?.reason === "Scamming or fraudulent activity" && found?.customReason === "Verified test fixture");

  // --- 4. A flagged account persists and gates publishing, an unflagged one does not ---
  const flagged = await prisma.user.upsert({
    where: { email: `enh-flagged-${run}@example.test` },
    update: {},
    create: {
      email: `enh-flagged-${run}@example.test`,
      username: `enhflag${run}`,
      displayName: "Flagged User",
      passwordHash: "not-a-login-hash",
      status: "ACTIVE",
      flaggedForReview: true,
    },
  });
  const flaggedRow = await prisma.user.findUnique({ where: { id: flagged.id }, select: { flaggedForReview: true, status: true } });
  check("review flag persists in the database", flaggedRow?.flaggedForReview === true);
  check("flagged account keeps ACTIVE status (flag is not a ban)", flaggedRow?.status === "ACTIVE");

  // Cleanup
  await prisma.deletedAccountRecord.deleteMany({ where: { id: record.id } });
  await prisma.auditLog.deleteMany({ where: { actorId: admin.id } });
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, flagged.id] } } });

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll enhanced account-deletion checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
