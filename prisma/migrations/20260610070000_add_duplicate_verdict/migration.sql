-- Persisted nightly LLM adjudication verdicts (scripts/merge-dups.ts). One row per
-- judged candidate pair, keyed by the two event ids sorted lexicographically
-- (`${minId}:${maxId}`). Drives the admin dedup UI's "uncertain band" view and lets
-- the cron skip re-judging settled pairs. Errored adjudications are never written.
CREATE TABLE "duplicate_verdicts" (
    "id" TEXT NOT NULL,
    "pairKey" TEXT NOT NULL,
    "same" BOOLEAN NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "judgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duplicate_verdicts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "duplicate_verdicts_pairKey_key" ON "duplicate_verdicts"("pairKey");

CREATE INDEX "duplicate_verdicts_same_confidence_idx" ON "duplicate_verdicts"("same", "confidence");
