-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'FOLLOWED_SELLER_LISTING';
ALTER TYPE "NotificationType" ADD VALUE 'SEARCH_MATCH';
ALTER TYPE "NotificationType" ADD VALUE 'PRICE_CHANGE';
ALTER TYPE "NotificationType" ADD VALUE 'LISTING_UPDATE';
ALTER TYPE "NotificationType" ADD VALUE 'FAVOURITE_UPDATE';
ALTER TYPE "NotificationType" ADD VALUE 'SHOP_UPDATE';
ALTER TYPE "NotificationType" ADD VALUE 'SERVICE_UPDATE';
ALTER TYPE "NotificationType" ADD VALUE 'REAL_ESTATE_UPDATE';
ALTER TYPE "NotificationType" ADD VALUE 'MESSAGE';
ALTER TYPE "NotificationType" ADD VALUE 'ACCOUNT';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "relatedListingId" TEXT,
ADD COLUMN     "relatedPropertyId" TEXT,
ADD COLUMN     "relatedSearchId" TEXT,
ADD COLUMN     "relatedSellerId" TEXT,
ADD COLUMN     "relatedServiceId" TEXT,
ADD COLUMN     "relatedShopId" TEXT;

-- CreateTable
CREATE TABLE "SellerFollow" (
    "id" TEXT NOT NULL,
    "followerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerFollow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SellerFollow_sellerId_idx" ON "SellerFollow"("sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "SellerFollow_followerId_sellerId_key" ON "SellerFollow"("followerId", "sellerId");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "SellerFollow" ADD CONSTRAINT "SellerFollow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerFollow" ADD CONSTRAINT "SellerFollow_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
