import "dotenv/config";

// Points Prisma at the dedicated *_test database BEFORE any client connects, matching
// the fail-closed convention of scripts/db-guard.ts and scripts/test-e2e.ts. Import
// this module FIRST in a verification script (before importing "@/lib/prisma" or
// "@/lib/email"): ES modules evaluate dependencies in import-declaration order, so
// this side effect runs before the Prisma client module is loaded. Scripts that create
// fixtures, delete rows or process queued email jobs must never touch production.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("Refusing to run: set TEST_DATABASE_URL to a dedicated *_test database first. No queries were executed.");
}
const databaseName = decodeURIComponent(new URL(testDatabaseUrl).pathname.replace(/^\/+/, ""));
if (!databaseName.endsWith("_test")) {
  throw new Error("Refusing to run: TEST_DATABASE_URL must name a database ending in _test. No queries were executed.");
}
process.env.DATABASE_URL = testDatabaseUrl;

export {};
