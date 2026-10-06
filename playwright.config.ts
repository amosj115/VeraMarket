import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required to run E2E tests.");
}
const databaseName = decodeURIComponent(new URL(testDatabaseUrl).pathname.replace(/^\/+/, ""));
if (!databaseName.endsWith("_test")) {
  throw new Error("E2E tests are blocked unless TEST_DATABASE_URL names a database ending in _test.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: testDatabaseUrl,
      NEXTAUTH_URL: "http://127.0.0.1:3100",
      NEXT_DIST_DIR: ".next-e2e",
      AUTH_TRUST_HOST: "true",
      ALLOW_LOCAL_STORAGE: "true",
    },
  },
});
