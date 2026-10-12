-- AlterEnum
-- This migration adds new values to the JobStatus enum for the notification queue.
-- We use ALTER TYPE ... ADD VALUE for PostgreSQL compatibility.

ALTER TYPE "JobStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "JobStatus" ADD VALUE 'PERMANENT_FAILURE';
