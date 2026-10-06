import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();
const runId = randomUUID();
const email = `e2e-${runId}@example.test`;
const username = `e2e_${runId.replaceAll("-", "").slice(0, 24)}`;
const title = `E2E pending listing ${runId.slice(0, 8)}`;
const uploadUrls: string[] = [];

async function register(page: Page) {
  await page.goto("/register");
  await page.getByLabel("Full name").fill("E2E Test Seller");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("TestPassword123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding\/profile$/);
}

test.afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
  await Promise.all(uploadUrls.map(async (url) => {
    const filename = path.basename(url);
    if (/^[a-f0-9-]+\.(jpg|png|webp)$/.test(filename)) {
      await rm(path.join(process.cwd(), "public", "uploads", filename), { force: true });
    }
  }));
});

test("new seller can register and submit a product that remains private pending review", async ({ page }) => {
  await register(page);
  await page.goto("/sell");
  await expect(page.getByRole("heading", { name: "Create a listing" })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: "test-listing.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jg3sAAAAASUVORK5CYII=", "base64"),
  });
  page.on("response", async (response) => {
    if (response.url().includes("/api/uploads") && response.ok()) {
      const data = await response.json().catch(() => null) as { url?: string } | null;
      if (data?.url) uploadUrls.push(data.url);
    }
  });
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Description").fill("Playwright-created listing used only in the isolated E2E database.");
  await page.getByLabel("Price (ZAR)").fill("1250");
  await page.getByLabel("Category").selectOption({ index: 1 });
  await page.getByLabel("Location").fill("Cape Town");
  await page.getByRole("button", { name: "Submit for review" }).click();

  await expect(page).toHaveURL(/\/profile\/listings\?submitted=1$/);
  await expect(page.getByRole("status")).toContainText("submitted for review");
  await expect(page.getByText(title)).toBeVisible();
  await expect(page.getByText("Status: PENDING REVIEW")).toBeVisible();

  const response = await page.request.get(`/api/listings?q=${encodeURIComponent(title)}`);
  expect(response.ok()).toBeTruthy();
  const results = await response.json() as { listings: Array<{ title: string }> };
  expect(results.listings).toEqual([]);
});

test("private listing creation API rejects an unauthenticated request", async ({ request }) => {
  const response = await request.post("/api/listings", { data: {} });
  expect(response.status()).toBe(401);
});

test("trending supports likes and saved listings for an authenticated user", async ({ page }) => {
  const trendingEmail = `e2e-trending-${runId}@example.test`;
  const trendingUsername = `trend_${runId.replaceAll("-", "").slice(0, 20)}`;
  const trendingTitle = `Trending E2E listing ${runId.slice(0, 8)}`;

  await page.goto("/register");
  await page.getByLabel("Full name").fill("E2E Trending User");
  await page.getByLabel("Username").fill(trendingUsername);
  await page.getByLabel("Email").fill(trendingEmail);
  await page.getByLabel("Password").fill("TestPassword123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding\/profile$/);

  const user = await prisma.user.findUniqueOrThrow({ where: { email: trendingEmail }, select: { id: true } });
  const category = await prisma.category.findFirstOrThrow({ where: { domain: "MARKETPLACE", isEnabled: true } });
  const listing = await prisma.listing.create({
    data: {
      sellerId: user.id,
      categoryId: category.id,
      title: trendingTitle,
      slug: `trending-e2e-${runId.slice(0, 12)}`,
      description: "Active test listing for the trending feed.",
      priceCents: 150000,
      condition: "GOOD",
      location: "Cape Town",
      status: "ACTIVE",
    },
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/trending");
  await expect(page.getByRole("heading", { name: "Trending for You" })).toBeVisible();
  await expect(page.getByRole("link", { name: trendingTitle, exact: true })).toBeVisible();
  const fitsMobile = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fitsMobile).toBeTruthy();
  const likeButton = page.getByRole("button", { name: /Like ·/ });
  await likeButton.click();
  await expect(page.getByRole("button", { name: /Liked · 1/ })).toBeVisible();
  await page.getByRole("button", { name: /Save ·/ }).click();
  await expect(page.getByRole("button", { name: /Saved ·/ })).toBeVisible();

  await page.goto("/profile/liked");
  await expect(page.getByText(trendingTitle)).toBeVisible();
  expect(await prisma.listingLike.findUnique({ where: { userId_listingId: { userId: user.id, listingId: listing.id } } })).toBeTruthy();
  await page.getByRole("button", { name: "Unlike" }).click();
  await expect(page.getByText("No liked listings yet")).toBeVisible();
  await page.goto("/profile/saved");
  await expect(page.getByText(trendingTitle)).toBeVisible();
  expect(await prisma.favorite.findUnique({ where: { userId_listingId: { userId: user.id, listingId: listing.id } } })).toBeTruthy();
  await page.getByRole("button", { name: "Remove from favorites" }).click();
  await expect(page.getByText("No saved listings yet")).toBeVisible();
  expect(await prisma.listingLike.findUnique({ where: { userId_listingId: { userId: user.id, listingId: listing.id } } })).toBeNull();
  expect(await prisma.favorite.findUnique({ where: { userId_listingId: { userId: user.id, listingId: listing.id } } })).toBeNull();
});
