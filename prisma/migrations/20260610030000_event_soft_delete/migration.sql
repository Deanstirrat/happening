-- Soft delete for admin event actions (issue #103). Admin "delete" now sets
-- status → TRASHED + stamps deletedAt instead of removing the row, so a mis-click
-- is recoverable from the trash UI until a periodic purge hard-deletes it.

-- AlterEnum
ALTER TYPE "EventStatus" ADD VALUE 'TRASHED';

-- AlterTable
ALTER TABLE "events" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "events_status_deletedAt_idx" ON "events"("status", "deletedAt");
