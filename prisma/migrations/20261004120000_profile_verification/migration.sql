-- AlterTable
ALTER TABLE "User" ADD COLUMN     "profilePhotoConsentAt" TIMESTAMP(3),
ADD COLUMN     "profileVerification" "VerificationStatus" NOT NULL DEFAULT 'NOT_VERIFIED',
ADD COLUMN     "profileVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FaceVerificationAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaceVerificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FaceVerificationAttempt_userId_createdAt_idx" ON "FaceVerificationAttempt"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "FaceVerificationAttempt" ADD CONSTRAINT "FaceVerificationAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
