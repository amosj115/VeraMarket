-- AlterTable
ALTER TABLE "User" ADD COLUMN     "flaggedForReview" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DeletedAccountRecord" (
    "id" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "customReason" TEXT,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedByUserId" TEXT NOT NULL,

    CONSTRAINT "DeletedAccountRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeletedAccountRecord_emailHash_key" ON "DeletedAccountRecord"("emailHash");

-- CreateIndex
CREATE INDEX "DeletedAccountRecord_emailHash_idx" ON "DeletedAccountRecord"("emailHash");

-- AddForeignKey
ALTER TABLE "DeletedAccountRecord" ADD CONSTRAINT "DeletedAccountRecord_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
