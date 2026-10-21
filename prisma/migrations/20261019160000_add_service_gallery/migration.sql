ALTER TABLE "ServiceListing" ADD COLUMN "coverImageUrl" TEXT;

CREATE INDEX "Image_serviceId_ownerType_sortOrder_idx"
ON "Image"("serviceId", "ownerType", "sortOrder");
