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

test("active listings appear in Trending and marketplace users can like and save them", async ({ page }) => {
  const marketplaceEmail = `e2e-marketplace-${runId}@example.test`;
  const marketplaceUsername = `market_${runId.replaceAll("-", "").slice(0, 20)}`;
  const marketplaceTitle = `Marketplace E2E listing ${runId.slice(0, 8)}`;

  await page.goto("/register");
  await page.getByLabel("Full name").fill("E2E Marketplace User");
  await page.getByLabel("Username").fill(marketplaceUsername);
  await page.getByLabel("Email").fill(marketplaceEmail);
  await page.getByLabel("Password").fill("TestPassword123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding\/profile$/);

  const user = await prisma.user.findUniqueOrThrow({ where: { email: marketplaceEmail }, select: { id: true } });
  const category = await prisma.category.findFirstOrThrow({ where: { domain: "MARKETPLACE", isEnabled: true } });
  const listing = await prisma.listing.create({
    data: {
      sellerId: user.id,
      categoryId: category.id,
      title: marketplaceTitle,
      slug: `marketplace-e2e-${runId.slice(0, 12)}`,
      description: "Active test listing for marketplace and account coverage.",
      priceCents: 150000,
      condition: "GOOD",
      location: "Cape Town",
      status: "ACTIVE",
    },
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Trending for You", exact: true })).toBeVisible();
  const trendingHomeLink = page.getByRole("link", { name: /View All/ });
  await expect(trendingHomeLink).toBeVisible();
  await expect(trendingHomeLink).toHaveAttribute("href", "/trending");
  const homepageListingLink = page.getByRole("link", { name: `View listing ${marketplaceTitle}` });
  await expect(homepageListingLink).toHaveAttribute("href", `/listing/${listing.slug}`);
  const homeFitsDesktop = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(homeFitsDesktop).toBeTruthy();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Trending for You", exact: true })).toBeVisible();
  await expect(trendingHomeLink).toBeVisible();
  await expect(homepageListingLink).toBeVisible();
  const homeFitsMobile = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(homeFitsMobile).toBeTruthy();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/trending");
  await expect(page.getByRole("heading", { name: "Trending", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: marketplaceTitle, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: `View listing details for ${marketplaceTitle}` }))
    .toHaveAttribute("href", `/listing/${listing.slug}`);

  const feedViewport = page.getByRole("region", { name: "Trending listings feed" });
  const measureFeed = () => feedViewport.evaluate((feed) => {
    const slides = Array.from(feed.querySelectorAll<HTMLElement>("[data-trending-feed-item]"));
    const firstRect = slides[0]?.getBoundingClientRect();
    const nextRect = slides[1]?.getBoundingClientRect();
    const cardRect = slides[0]?.querySelector(".grid")?.getBoundingClientRect();
    const style = getComputedStyle(feed);
    return {
      snapType: style.scrollSnapType,
      snapStop: slides[0] ? getComputedStyle(slides[0]).scrollSnapStop : "",
      feedHeight: feed.clientHeight,
      firstSlideHeight: firstRect?.height ?? 0,
      nextSlideDistance: firstRect && nextRect ? nextRect.top - firstRect.top : null,
      cardHeight: cardRect?.height ?? 0,
      cardWidth: cardRect?.width ?? 0,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });

  const desktopFeed = await measureFeed();
  expect(desktopFeed.snapType).toContain("mandatory");
  expect(desktopFeed.snapStop).toBe("always");
  expect(desktopFeed.firstSlideHeight).toBe(desktopFeed.feedHeight);
  if (desktopFeed.nextSlideDistance !== null) expect(desktopFeed.nextSlideDistance).toBe(desktopFeed.feedHeight);
  expect(desktopFeed.cardWidth).toBeLessThan(desktopFeed.viewportWidth);
  expect(desktopFeed.cardHeight).toBeLessThan(desktopFeed.viewportHeight);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Trending", exact: true })).toBeVisible();
  const mobileFeed = await measureFeed();
  expect(mobileFeed.snapType).toContain("mandatory");
  expect(mobileFeed.snapStop).toBe("always");
  expect(mobileFeed.firstSlideHeight).toBe(mobileFeed.feedHeight);
  if (mobileFeed.nextSlideDistance !== null) expect(mobileFeed.nextSlideDistance).toBe(mobileFeed.feedHeight);
  const trendingFitsMobile = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(trendingFitsMobile).toBeTruthy();

  const searchActivityResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/search-activity") && response.request().method() === "POST"
  );
  await page.goto(`/marketplace?q=${encodeURIComponent(marketplaceTitle)}`);
  const searchActivityResponse = await searchActivityResponsePromise;
  expect(searchActivityResponse.ok()).toBeTruthy();
  await expect.poll(() => prisma.searchActivity.findFirst({
    where: { userId: user.id, query: marketplaceTitle.toLowerCase() },
    select: { id: true },
  })).not.toBeNull();
  const listingLink = page.locator(`a[href="/listing/${listing.slug}"]`);
  await expect(listingLink).toBeVisible();
  const fitsMobile = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fitsMobile).toBeTruthy();
  await listingLink.click();
  await page.getByRole("button", { name: "Save listing" }).click();
  await expect(page.getByText("Saved to favorites")).toBeVisible();
  await page.getByRole("button", { name: /Like listing/ }).click();
  await expect(page.getByRole("button", { name: /Unlike listing/ })).toBeVisible();

  await page.goto("/profile/liked");
  await expect(page.getByText(marketplaceTitle)).toBeVisible();
  expect(await prisma.listingLike.findUnique({ where: { userId_listingId: { userId: user.id, listingId: listing.id } } })).toBeTruthy();
  await page.getByRole("button", { name: "Unlike" }).click();
  await expect(page.getByText("No liked listings yet")).toBeVisible();
  await page.goto("/profile/saved");
  await expect(page.getByText(marketplaceTitle)).toBeVisible();
  expect(await prisma.favorite.findUnique({ where: { userId_listingId: { userId: user.id, listingId: listing.id } } })).toBeTruthy();
  await page.getByRole("button", { name: "Remove from favorites" }).click();
  await expect(page.getByText("No saved listings yet")).toBeVisible();
  expect(await prisma.listingLike.findUnique({ where: { userId_listingId: { userId: user.id, listingId: listing.id } } })).toBeNull();
  expect(await prisma.favorite.findUnique({ where: { userId_listingId: { userId: user.id, listingId: listing.id } } })).toBeNull();
});
