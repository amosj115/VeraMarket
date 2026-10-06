import "dotenv/config";
import { execSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("Set TEST_DATABASE_URL to a dedicated test database before running E2E tests.");
}
const databaseName = decodeURIComponent(new URL(testDatabaseUrl).pathname.replace(/^\/+/, ""));
if (!databaseName.endsWith("_test")) {
  throw new Error("Refusing to run E2E tests: TEST_DATABASE_URL database name must end in _test.");
}

const env = {
  ...process.env,
  DATABASE_URL: testDatabaseUrl,
  NEXTAUTH_URL: "http://127.0.0.1:3100",
  NEXT_DIST_DIR: ".next-e2e",
  AUTH_TRUST_HOST: "true",
  ALLOW_LOCAL_STORAGE: "true",
  // E2E users can't pass a real face check; the gate itself is covered by scripts/verify-profile.ts.
  PROFILE_VERIFICATION_ENFORCED: "false",
};

function run(command: string) {
  execSync(command, { stdio: "inherit", env, shell: process.env.ComSpec ?? "cmd.exe" });
}

async function cleanupTestAccounts() {
  const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
  try {
    await prisma.user.deleteMany({ where: { email: { startsWith: "e2e-" } } });
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  let schemaReady = false;
  try {
    await rm(env.NEXT_DIST_DIR, { recursive: true, force: true });
    run("npx prisma migrate deploy");
    schemaReady = true;
    run("npm run db:seed");
    await cleanupTestAccounts();
    run("npx next build");
    run("npx playwright test");
  } finally {
    if (schemaReady) await cleanupTestAccounts();
    await rm(env.NEXT_DIST_DIR, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
