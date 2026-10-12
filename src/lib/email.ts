import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";

/**
 * Escapes a string for safe interpolation into an HTML email body. Admin-supplied free
 * text (e.g. a custom deletion reason) must never be able to inject markup into the
 * emails we send on their behalf.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Utility to send transactional emails using the server's configured SMTP credentials.
 * Uses the environment variables defined in .env.example.
 */
export async function sendEmail({
  to,
  subject,
  text,
  html,
}: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}) {
  const host = process.env.EMAIL_SERVER_HOST;
  const port = parseInt(process.env.EMAIL_SERVER_PORT ?? "587", 10);
  const user = process.env.EMAIL_SERVER_USER;
  const pass = process.env.EMAIL_SERVER_PASSWORD;
  const from = process.env.EMAIL_FROM ?? "Vera Market <no-reply@veramarket.example>";

  if (!host || !user || !pass) {
    console.error("[email] Email server not configured. Skipping email delivery.");
    return { success: false, error: "NOT_CONFIGURED", isPermanent: false };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for other ports
    auth: { user, pass },
  });

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
    });
    return { success: true, messageId: info.messageId };
  } catch (error: unknown) {
    console.error("[email] Failed to send email to", to, { error });

    // Identify permanent failures:
    // 1. Nodemailer specific "Invalid address"
    // 2. SMTP 5xx response codes
    const err = error as { message?: string; response?: { statusCode?: number } };
    const isPermanent =
      err.message?.toLowerCase().includes("invalid address") ||
      (err.response && err.response.statusCode !== undefined && err.response.statusCode >= 500 && err.response.statusCode < 600);

    return { success: false, error: "PROVIDER_ERROR", isPermanent };
  }
}

/**
 * Resets jobs that have been in PROCESSING state for too long (e.g., > 30 mins).
 * This recovers jobs from crashed workers.
 */
export async function recoverStaleJobs() {
  const staleThreshold = new Date(Date.now() - 30 * 60_000);
  const recovered = await prisma.notificationJob.updateMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lte: staleThreshold },
    },
    data: {
      status: "FAILED",
      // We don't increment attempts here as the crash was not the job's fault,
      // but the existing logic in processNotificationQueue will increment it.
    },
  });
  if (recovered.count > 0) {
    console.log(`[email] Recovered ${recovered.count} stale processing jobs.`);
  }
  return recovered.count;
}

/**
 * Processes pending notification jobs from the database.
 * Designed to be called by a cron job or a background worker.
 */
export async function processNotificationQueue() {
  const startTime = Date.now();
  const TIME_BUDGET_MS = 45_000; // Exit loop before Vercel's typical timeout
  const MAX_ATTEMPTS = 8; // After this many transient failures the job becomes PERMANENT_FAILURE.

  await recoverStaleJobs();

  const now = new Date();
  const jobs = await prisma.notificationJob.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      nextRetryAt: { lte: now },
    },
    take: 10,
    orderBy: { createdAt: "asc" },
  });

  for (const job of jobs) {
    // Execution time safety: stop starting new jobs if we are close to the budget
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      console.warn("[email] Execution time budget reached. Stopping queue processing.");
      break;
    }

    // Atomic lock: only process if it's still PENDING or FAILED
    const locked = await prisma.notificationJob.updateMany({
      where: {
        id: job.id,
        status: { in: ["PENDING", "FAILED"] },
      },
      data: {
        status: "PROCESSING",
        updatedAt: new Date(),
      },
    });

    if (locked.count === 0) continue;

    const result = await sendEmail({
      to: job.recipientEmail,
      subject: job.subject,
      text: job.text,
      html: job.html ?? undefined,
    });

    if (result.success) {
      await prisma.notificationJob.update({
        where: { id: job.id },
        data: { status: "SENT" },
      });
    } else {
      const attempts = job.attempts + 1;
      if (result.isPermanent || attempts >= MAX_ATTEMPTS) {
        await prisma.notificationJob.update({
          where: { id: job.id },
          data: { status: "PERMANENT_FAILURE", attempts },
        });
      } else {
        const backoffMinutes = Math.pow(2, attempts) * 5; // 10, 20, 40...
        const nextRetry = new Date(Date.now() + backoffMinutes * 60_000);

        await prisma.notificationJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            attempts,
            nextRetryAt: nextRetry,
          },
        });
      }
    }
  }
  return { processed: jobs.length };
}
