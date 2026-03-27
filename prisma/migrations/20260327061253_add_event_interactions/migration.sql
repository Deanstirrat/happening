-- CreateEnum
CREATE TYPE "InteractionType" AS ENUM ('VIEW', 'CLICK');

-- CreateTable
CREATE TABLE "event_interactions" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" "InteractionType" NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_interactions_eventId_idx" ON "event_interactions"("eventId");

-- CreateIndex
CREATE INDEX "event_interactions_eventId_type_idx" ON "event_interactions"("eventId", "type");

-- CreateIndex
CREATE INDEX "event_interactions_createdAt_idx" ON "event_interactions"("createdAt");

-- AddForeignKey
ALTER TABLE "event_interactions" ADD CONSTRAINT "event_interactions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
