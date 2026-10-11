-- Additive indexes for measured query plans (EXPLAIN showed sequential scans on
-- Favorite and Notification, and unread-message updates that could not use an
-- index on readAt). No existing indexes are dropped or changed.

-- CreateIndex
CREATE INDEX "Favorite_listingId_createdAt_idx" ON "Favorite"("listingId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_readAt_idx" ON "Message"("conversationId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");