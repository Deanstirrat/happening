-- Persisted "not a duplicate" dismissals from the admin dedup review UI (issue #102).
-- pairKey is the two event ids sorted lexicographically (`${minId}:${maxId}`).
CREATE TABLE "duplicate_pair_dismissals" (
    "id" TEXT NOT NULL,
    "pairKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duplicate_pair_dismissals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "duplicate_pair_dismissals_pairKey_key" ON "duplicate_pair_dismissals"("pairKey");
