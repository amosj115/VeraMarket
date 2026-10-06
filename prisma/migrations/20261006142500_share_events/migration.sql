-- CreateEnum
CREATE TYPE "ShareTargetType" AS ENUM ('LISTING', 'SHOP', 'SERVICE', 'PROPERTY', 'PROFILE');

-- CreateEnum
CREATE TYPE "ShareEventKind" AS ENUM ('SHARE', 'LINK_VIEW', 'CHAT');

-- CreateTable
CREATE TABLE "ShareEvent" (
    "id" TEXT NOT NULL,
    "targetType" "ShareTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" "ShareEventKind" NOT NULL,
    "channel" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShareEvent_ownerId_kind_createdAt_idx" ON "ShareEvent"("ownerId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "ShareEvent_targetType_targetId_kind_idx" ON "ShareEvent"("targetType", "targetId", "kind");
