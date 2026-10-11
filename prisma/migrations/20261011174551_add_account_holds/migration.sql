-- CreateTable
CREATE TABLE "AccountHold" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "placedById" TEXT NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedById" TEXT,
    "liftedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "heldListingIds" JSONB,
    "heldShopIds" JSONB,
    "heldServiceIds" JSONB,
    "heldPropertyIds" JSONB,

    CONSTRAINT "AccountHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountHold_userId_active_idx" ON "AccountHold"("userId", "active");

-- CreateIndex
CREATE INDEX "AccountHold_active_idx" ON "AccountHold"("active");

-- CreateIndex
CREATE INDEX "AccountHold_placedAt_idx" ON "AccountHold"("placedAt");

-- AddForeignKey
ALTER TABLE "AccountHold" ADD CONSTRAINT "AccountHold_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountHold" ADD CONSTRAINT "AccountHold_placedById_fkey" FOREIGN KEY ("placedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountHold" ADD CONSTRAINT "AccountHold_liftedById_fkey" FOREIGN KEY ("liftedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
