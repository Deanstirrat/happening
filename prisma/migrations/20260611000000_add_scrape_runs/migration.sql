-- Per-run scraper outcome log (issue #101): persist each runScraper() outcome
-- (success/failure + error message) per source so the admin scrapers panel can
-- surface *why* a scraper went dark without needing shell access.
CREATE TABLE "scrape_runs" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "scraped" INTEGER NOT NULL DEFAULT 0,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scrape_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "scrape_runs_sourceId_createdAt_idx" ON "scrape_runs"("sourceId", "createdAt");

-- Cascade-delete a source's run history when the source itself is removed.
ALTER TABLE "scrape_runs" ADD CONSTRAINT "scrape_runs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
