import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

test("shop pages expose the virtual store experience and pricing", async ({ page }) => {
  await page.goto("/shops");
  await expect(page.getByRole("heading", { name: "Virtual Stores" })).toBeVisible();
  await expect(page.getByText("Public storefronts require an active R59/month subscription.")).toBeVisible();
  await page.goto("/shops/new");
  await expect(page.getByRole("heading", { name: "Create a Virtual Store" })).toBeVisible();
  await expect(page.getByText("R59 per month")).toBeVisible();
});

test("virtual store product pages support category filters and search", async ({ page }) => {
  const email = `store-filter-${Date.now()}@example.test`;
  const username = `storefilter${Date.now().toString().slice(-8)}`;
  const user = await prisma.user.create({
    data: {
      displayName: "Store Filter Test",
      username,
      email,
      passwordHash: "placeholder",
      role: "USER",
    },
  });

  const shop = await prisma.shop.create({
    data: {
      ownerId: user.id,
      name: "Garden Market",
      slug: `garden-market-${Date.now()}`,
      description: "Seasonal produce and home essentials.",
      address: "Cape Town",
      status: "ACTIVE",
      isPaused: false,
      subscriptionStatus: "ACTIVE",
      monthlyPriceCents: 5900,
      subscription: {
        create: {
          status: "ACTIVE",
          monthlyPriceCents: 5900,
          startsAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      },
    },
  });

  const produceCategory = await prisma.shopCategory.create({
    data: { shopId: shop.id, name: "Produce", slug: "produce", description: "Fresh goods" },
  });
  const pantryCategory = await prisma.shopCategory.create({
    data: { shopId: shop.id, name: "Pantry", slug: "pantry", description: "Shelf staples" },
  });

  await prisma.shopProduct.createMany({
    data: [
      { shopId: shop.id, categoryId: produceCategory.id, name: "Strawberry Box", description: "Sweet berries", priceCents: 12000, isAvailable: true },
      { shopId: shop.id, categoryId: pantryCategory.id, name: "Coconut Oil", description: "Kitchen staple", priceCents: 8900, isAvailable: true },
    ],
  });

  await page.goto(`/shops/${shop.slug}?q=berry&category=${produceCategory.slug}`);
  await expect(page.getByRole("heading", { name: "Garden Market" })).toBeVisible();
  await expect(page.getByText("Strawberry Box")).toBeVisible();
  await expect(page.getByText("Coconut Oil")).toHaveCount(0);

  await page.goto(`/shops/${shop.slug}?q=berry`);
  await expect(page.getByText("Strawberry Box")).toBeVisible();

  await prisma.shop.delete({ where: { id: shop.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
});
