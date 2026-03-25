-- CreateEnum
CREATE TYPE "ScrapeType" AS ENUM ('CHEERIO', 'PLAYWRIGHT', 'API');

-- CreateEnum
CREATE TYPE "EventCategory" AS ENUM ('MUSIC_ELECTRONIC', 'MUSIC_ROCK_PUNK', 'MUSIC_JAZZ_BLUES', 'MUSIC_HIPHOP', 'MUSIC_CLASSICAL', 'MUSIC_OTHER', 'ART_GALLERY', 'ART_PERFORMANCE', 'COMEDY', 'FOOD_DRINK', 'NIGHTLIFE', 'COMMUNITY', 'TECH', 'SPORTS_FITNESS', 'FILM', 'THEATER', 'OUTDOOR', 'FAMILY', 'OTHER');

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "scrapeType" "ScrapeType" NOT NULL,
    "lastScrapedAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "dedupeHash" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "venueName" TEXT,
    "venueAddress" TEXT,
    "city" TEXT NOT NULL DEFAULT 'San Francisco',
    "neighborhood" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "category" "EventCategory",
    "categoryRaw" TEXT,
    "price" TEXT,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "imageUrl" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "tags" TEXT[],
    "geocoded" BOOLEAN NOT NULL DEFAULT false,
    "categorized" BOOLEAN NOT NULL DEFAULT false,
    "sourceId" TEXT NOT NULL,
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sources_slug_key" ON "sources"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "events_dedupeHash_key" ON "events"("dedupeHash");

-- CreateIndex
CREATE INDEX "events_startDate_idx" ON "events"("startDate");

-- CreateIndex
CREATE INDEX "events_neighborhood_idx" ON "events"("neighborhood");

-- CreateIndex
CREATE INDEX "events_category_idx" ON "events"("category");

-- CreateIndex
CREATE INDEX "events_sourceId_idx" ON "events"("sourceId");

-- CreateIndex
CREATE INDEX "events_startDate_neighborhood_category_idx" ON "events"("startDate", "neighborhood", "category");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
