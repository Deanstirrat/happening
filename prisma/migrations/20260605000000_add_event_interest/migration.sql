-- CreateTable
CREATE TABLE "event_interests" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_interests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_interests_eventId_idx" ON "event_interests"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "event_interests_eventId_sessionId_key" ON "event_interests"("eventId", "sessionId");

-- AddForeignKey
ALTER TABLE "event_interests" ADD CONSTRAINT "event_interests_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
