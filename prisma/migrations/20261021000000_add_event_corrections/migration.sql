-- Organizer-submitted structured corrections for auto-ingested events (issue
-- #215). Backs the "suggest a fix" section of the event-page report modal;
-- suggestedEdits holds only the changed fields, which an admin can apply in one
-- click. Additive-only: a new table, no changes to existing tables.
CREATE TABLE "event_corrections" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "suggestedEdits" JSONB NOT NULL,
    "comment" TEXT,
    "email" TEXT,
    "isOrganizer" BOOLEAN NOT NULL DEFAULT false,
    "status" "ReportStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_corrections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "event_corrections_eventId_idx" ON "event_corrections"("eventId");
CREATE INDEX "event_corrections_status_idx" ON "event_corrections"("status");

-- Cascade-delete an event's corrections when the event itself is removed.
ALTER TABLE "event_corrections" ADD CONSTRAINT "event_corrections_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
