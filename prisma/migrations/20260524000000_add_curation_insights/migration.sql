CREATE TABLE "curation_insights" (
    "id" TEXT NOT NULL,
    "weekOf" TIMESTAMP(3) NOT NULL,
    "insight" TEXT NOT NULL,
    "topEvents" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "curation_insights_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "curation_insights_weekOf_key" ON "curation_insights"("weekOf");
CREATE INDEX "curation_insights_weekOf_idx" ON "curation_insights"("weekOf");
