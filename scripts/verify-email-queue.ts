import "./test-db-env";
import { prisma } from "@/lib/prisma";
import { processNotificationQueue, recoverStaleJobs } from "@/lib/email";

// Exercises the email-queue state machine (stale recovery, FAILED transitions, attempt
// counters, PERMANENT_FAILURE) against the dedicated *_test database only — this script
// creates fixture jobs and processes every due job, so it must never touch production.

async function testQueue() {
  console.log("Starting Email Queue Reliability Verification...");

  // 1. Test Recovery of Stale Jobs
  console.log("\nTesting stale job recovery...");
  const staleJob = await prisma.notificationJob.create({
    data: {
      recipientEmail: "stale@example.com",
      subject: "Stale Test",
      text: "This should be recovered",
      status: "PROCESSING",
      updatedAt: new Date(Date.now() - 40 * 60_000), // 40 mins ago
    },
  });

  await recoverStaleJobs();
  const recoveredJob = await prisma.notificationJob.findUnique({ where: { id: staleJob.id } });

  if (recoveredJob?.status === "FAILED") {
    console.log("✅ Stale job recovered correctly.");
  } else {
    console.error(`❌ Stale job not recovered. Status: ${recoveredJob?.status}`);
  }

  // 2. Test non-recovery of recent jobs
  console.log("\nTesting recent job preservation...");
  const recentJob = await prisma.notificationJob.create({
    data: {
      recipientEmail: "recent@example.com",
      subject: "Recent Test",
      text: "This should NOT be recovered",
      status: "PROCESSING",
      updatedAt: new Date(),
    },
  });

  await recoverStaleJobs();
  const recentJobState = await prisma.notificationJob.findUnique({ where: { id: recentJob.id } });

  if (recentJobState?.status === "PROCESSING") {
    console.log("✅ Recent job preserved correctly.");
  } else {
    console.error(`❌ Recent job was incorrectly recovered. Status: ${recentJobState?.status}`);
  }

  // 3. Test Queue Processing State Transitions (with missing SMTP config)
  console.log("\nTesting queue state transitions (expecting failure due to missing config)...");
  const pendingJob = await prisma.notificationJob.create({
    data: {
      recipientEmail: "pending@example.com",
      subject: "Pending Test",
      text: "Should fail safely",
      status: "PENDING",
      nextRetryAt: new Date(0),
    },
  });

  await processNotificationQueue();
  const finalJob = await prisma.notificationJob.findUnique({ where: { id: pendingJob.id } });

  if (finalJob?.status === "FAILED") {
    console.log("✅ Job transitioned to FAILED as expected (missing config).");
  } else {
    console.error(`❌ Job failed to transition to FAILED. Status: ${finalJob?.status}`);
  }

  // 4. Test Attempt Counters
  if (finalJob?.attempts === 1) {
    console.log("✅ Attempt counter incremented correctly.");
  } else {
    console.error(`❌ Attempt counter not incremented. Attempts: ${finalJob?.attempts}`);
  }

  // 5. Test Permanent Failure (Simulated via a custom mock or direct status check)
  // Since we can't easily mock the nodemailer internals inside this script without rewriting sendEmail,
  // we verify that the state is at least supported by the schema.
  console.log("\nTesting PERMANENT_FAILURE state support...");
  const permanentJob = await prisma.notificationJob.create({
    data: {
      recipientEmail: "permanent@example.com",
      subject: "Perm Test",
      text: "Permanent fail",
      status: "PERMANENT_FAILURE",
    },
  });

  const verifiedPerm = await prisma.notificationJob.findUnique({ where: { id: permanentJob.id } });
  if (verifiedPerm?.status === "PERMANENT_FAILURE") {
    console.log("✅ PERMANENT_FAILURE state correctly stored in database.");
  } else {
    console.error(`❌ PERMANENT_FAILURE state not stored. Status: ${verifiedPerm?.status}`);
  }

  // 6. Test attempt cap: a job at MAX_ATTEMPTS - 1 that fails again becomes PERMANENT_FAILURE
  console.log("\nTesting attempt cap...");
  const cappedJob = await prisma.notificationJob.create({
    data: {
      recipientEmail: "capped@example.com",
      subject: "Capped Test",
      text: "Should hit the retry limit",
      status: "FAILED",
      attempts: 7, // MAX_ATTEMPTS is 8; one more failure must not schedule another retry.
      nextRetryAt: new Date(0),
    },
  });

  await processNotificationQueue();
  const cappedState = await prisma.notificationJob.findUnique({ where: { id: cappedJob.id } });

  if (cappedState?.status === "PERMANENT_FAILURE" && cappedState?.attempts === 8) {
    console.log("✅ Attempt cap correctly moved the job to PERMANENT_FAILURE.");
  } else {
    console.error(`❌ Attempt cap not enforced. Status: ${cappedState?.status}, attempts: ${cappedState?.attempts}`);
  }

  // Cleanup fixtures so repeated runs start clean.
  await prisma.notificationJob.deleteMany({
    where: { recipientEmail: { in: ["stale@example.com", "recent@example.com", "pending@example.com", "permanent@example.com", "capped@example.com"] } },
  });

  console.log("\nVerification complete.");
}

testQueue().catch(console.error);
