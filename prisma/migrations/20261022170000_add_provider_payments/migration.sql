-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "ShopSubscription" ADD COLUMN     "autoRenew" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastRenewalError" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "providerInitialTxId" TEXT,
ADD COLUMN     "providerToken" TEXT,
ADD COLUMN     "renewalAttempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'INITIAL',
ADD COLUMN     "providerCheckoutId" TEXT,
ADD COLUMN     "providerPaymentId" TEXT,
ADD COLUMN     "subscriptionId" TEXT;

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "providerRef" TEXT,
    "outcome" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_providerRef_idx" ON "PaymentWebhookEvent"("providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookEvent_provider_eventId_key" ON "PaymentWebhookEvent"("provider", "eventId");

-- CreateIndex
CREATE INDEX "ShopSubscription_autoRenew_renewsAt_idx" ON "ShopSubscription"("autoRenew", "renewsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerCheckoutId_key" ON "Payment"("providerCheckoutId");

-- CreateIndex
CREATE INDEX "Payment_subscriptionId_idx" ON "Payment"("subscriptionId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ShopSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
