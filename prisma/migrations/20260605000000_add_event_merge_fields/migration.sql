-- Semantic-merge bookkeeping on events.
ALTER TABLE "events" ADD COLUMN "mergedIntoId" TEXT;
ALTER TABLE "events" ADD COLUMN "mergeProvenance" JSONB;

CREATE INDEX "events_mergedIntoId_idx" ON "events"("mergedIntoId");
