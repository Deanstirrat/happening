-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED');

-- AlterEnum
ALTER TYPE "ScrapeType" ADD VALUE 'MANUAL';

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "status" "EventStatus" NOT NULL DEFAULT 'PUBLISHED',
ADD COLUMN     "submitterNote" TEXT;

-- CreateIndex
CREATE INDEX "events_status_idx" ON "events"("status");
