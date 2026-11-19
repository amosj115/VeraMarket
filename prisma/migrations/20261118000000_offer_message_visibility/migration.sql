ALTER TABLE "Message" ADD COLUMN "visibleToId" TEXT;

UPDATE "Message" AS m
SET "visibleToId" = o."buyerId"
FROM "Offer" AS o
WHERE m."offerId" = o."id"
  AND m."kind" = 'SYSTEM'
  AND m."body" LIKE '🎉 Offer accepted!%';

CREATE INDEX "Message_conversationId_visibleToId_createdAt_idx"
ON "Message"("conversationId", "visibleToId", "createdAt");
