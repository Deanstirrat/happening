-- Per-session preference vectors (issue #99) build category/neighborhood
-- affinities by scanning a session's interaction history. Both lookups filter
-- on sessionId, which was previously unindexed (EventInterest's only sessionId
-- coverage was the [eventId, sessionId] unique index, unusable for a
-- sessionId-only query).
CREATE INDEX "event_interactions_sessionId_idx" ON "event_interactions"("sessionId");
CREATE INDEX "event_interests_sessionId_idx" ON "event_interests"("sessionId");
