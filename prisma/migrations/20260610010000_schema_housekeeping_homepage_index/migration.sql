-- Drop the never-populated, never-read categoryRaw column.
ALTER TABLE "events" DROP COLUMN "categoryRaw";

-- Composite index supporting the homepage query shape: PUBLISHED events filtered
-- by a startDate window and ordered by startDate, plus the featured carousel.
CREATE INDEX "events_status_startDate_featured_idx" ON "events"("status", "startDate", "featured");
