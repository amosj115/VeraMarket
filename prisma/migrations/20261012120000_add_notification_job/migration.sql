-- The NotificationJob email queue and its base JobStatus enum were originally created
-- with `prisma db push`, so no migration in the history creates them. That left any
-- fresh database (new environment, CI, the local *_test database) unable to migrate:
-- 20261013000000_add_email_queue_statuses runs `ALTER TYPE "JobStatus" ADD VALUE`,
-- which fails because the type does not exist.
--
-- This migration creates the base objects for fresh databases. Every statement is
-- guarded so it is a no-op on databases (like dev/prod) where `db push` already
-- created them, and it intentionally creates only the ORIGINAL enum values
-- (PENDING, SENT, FAILED): 20261013000000 then adds PROCESSING and PERMANENT_FAILURE
-- in its original, already-applied form.

-- CreateEnum (guarded)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'JobStatus') THEN
    CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');
  END IF;
END $$;

-- CreateTable (guarded)
CREATE TABLE IF NOT EXISTS "NotificationJob" (
    "id" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "html" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (guarded)
CREATE INDEX IF NOT EXISTS "NotificationJob_status_nextRetryAt_idx" ON "NotificationJob"("status", "nextRetryAt");
