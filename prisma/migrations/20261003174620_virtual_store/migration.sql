/*
  Warnings:

  - A unique constraint covering the columns `[userId,shopProductId]` on the table `Favorite` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED', 'PENDING');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'STORE_FOLLOWED';
ALTER TYPE "NotificationType" ADD VALUE 'STORE_PRODUCT_ADDED';
ALTER TYPE "NotificationType" ADD VALUE 'STORE_UPDATE';
ALTER TYPE "NotificationType" ADD VALUE 'STORE_SUBSCRIPTION_ACTIVE';

-- AlterEnum
ALTER TYPE "PaymentPurpose" ADD VALUE 'VIRTUAL_STORE_SUBSCRIPTION';

-- DropIndex
DROP INDEX "ShopProduct_shopId_idx";

-- AlterTable
ALTER TABLE "Favorite" ADD COLUMN     "shopProductId" TEXT;

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "isPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "monthlyPriceCents" INTEGER NOT NULL DEFAULT 5900,
ADD COLUMN     "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "ShopProduct" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "condition" "ListingCondition" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "salePriceCents" INTEGER,
ADD COLUMN     "stockQuantity" INTEGER;

-- CreateTable
CREATE TABLE "ShopCategory" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSubscription" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "monthlyPriceCents" INTEGER NOT NULL DEFAULT 5900,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "renewsAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopFollower" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopFollower_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShopCategory_shopId_sortOrder_idx" ON "ShopCategory"("shopId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ShopCategory_shopId_slug_key" ON "ShopCategory"("shopId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ShopSubscription_shopId_key" ON "ShopSubscription"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopSubscription_paymentId_key" ON "ShopSubscription"("paymentId");

-- CreateIndex
CREATE INDEX "ShopSubscription_status_renewsAt_idx" ON "ShopSubscription"("status", "renewsAt");

-- CreateIndex
CREATE INDEX "ShopFollower_shopId_idx" ON "ShopFollower"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopFollower_userId_shopId_key" ON "ShopFollower"("userId", "shopId");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_userId_shopProductId_key" ON "Favorite"("userId", "shopProductId");

-- CreateIndex
CREATE INDEX "ShopProduct_shopId_categoryId_idx" ON "ShopProduct"("shopId", "categoryId");

-- CreateIndex
CREATE INDEX "ShopProduct_isFeatured_createdAt_idx" ON "ShopProduct"("isFeatured", "createdAt");

-- AddForeignKey
ALTER TABLE "ShopCategory" ADD CONSTRAINT "ShopCategory_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopSubscription" ADD CONSTRAINT "ShopSubscription_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopSubscription" ADD CONSTRAINT "ShopSubscription_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopFollower" ADD CONSTRAINT "ShopFollower_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopFollower" ADD CONSTRAINT "ShopFollower_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopProduct" ADD CONSTRAINT "ShopProduct_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ShopCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_shopProductId_fkey" FOREIGN KEY ("shopProductId") REFERENCES "ShopProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
