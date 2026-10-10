import "dotenv/config";

// Fail-closed gate for verification scripts. They create fixtures, publish
// content, fan out notifications to real accounts and delete rows, so they must
// never run against the production database by accident.
//
// Mirrors the existing convention in playwright.config.ts / scripts/test-e2e.ts:
// only a database whose name ends in "_test" is considered safe. To run against
// anything else (e.g. a shared development database), the override
// VERIFY_ALLOW_NON_TEST_DB=1 must be set explicitly. The check runs at import
// time, before any query can execute, and never prints connection details.
const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) {
  throw new Error("Refusing to run: DATABASE_URL is not set. No queries were executed.");
}
let databaseName = "";
try {
  databaseName = decodeURIComponent(new URL(rawUrl).pathname.replace(/^\/+/, ""));
} catch {
  throw new Error("Refusing to run: DATABASE_URL could not be parsed. No queries were executed.");
}
if (!databaseName.endsWith("_test") && process.env.VERIFY_ALLOW_NON_TEST_DB !== "1") {
  throw new Error(
    "Refusing to run: DATABASE_URL does not name a database ending in _test. " +
      "Point DATABASE_URL at a dedicated *_test database (see TEST_DATABASE_URL in .env), " +
      "or set VERIFY_ALLOW_NON_TEST_DB=1 if running against this shared database is intentional. " +
      "No queries were executed.",
  );
}
export {};
