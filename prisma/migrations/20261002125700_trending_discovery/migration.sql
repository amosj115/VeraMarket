-- CreateEnum
CREATE TYPE "ListingEngagementType" AS ENUM ('VIEW', 'SHARE', 'CONTACT');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'TRENDING_MATCH';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "trendingNotificationsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ListingLike" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingEngagement" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "ListingEngagementType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingEngagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "query" VARCHAR(100) NOT NULL,
    "categorySlug" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ListingLike_listingId_createdAt_idx" ON "ListingLike"("listingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ListingLike_userId_listingId_key" ON "ListingLike"("userId", "listingId");

-- CreateIndex
CREATE INDEX "ListingEngagement_listingId_type_createdAt_idx" ON "ListingEngagement"("listingId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "ListingEngagement_type_createdAt_idx" ON "ListingEngagement"("type", "createdAt");

-- CreateIndex
CREATE INDEX "SearchActivity_createdAt_query_idx" ON "SearchActivity"("createdAt", "query");

-- CreateIndex
CREATE INDEX "SearchActivity_userId_createdAt_idx" ON "SearchActivity"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SearchActivity_categorySlug_createdAt_idx" ON "SearchActivity"("categorySlug", "createdAt");

-- AddForeignKey
ALTER TABLE "ListingLike" ADD CONSTRAINT "ListingLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingLike" ADD CONSTRAINT "ListingLike_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingEngagement" ADD CONSTRAINT "ListingEngagement_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingEngagement" ADD CONSTRAINT "ListingEngagement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchActivity" ADD CONSTRAINT "SearchActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
