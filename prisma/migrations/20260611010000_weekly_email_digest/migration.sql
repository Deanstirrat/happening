-- Weekly "this weekend in SF" email digest (issue #97).

-- Accounts are opted in by default (signing up is the consent); they opt out via
-- the one-click unsubscribe link in every email. Existing rows pick up the
-- DEFAULT, so every current account is enrolled.
ALTER TABLE "users" ADD COLUMN "digestOptIn" BOOLEAN NOT NULL DEFAULT true;

-- Capability token for the no-login unsubscribe link. Minted lazily on first
-- send, so it stays null until then. Unique, but Postgres allows many NULLs.
ALTER TABLE "users" ADD COLUMN "unsubscribeToken" TEXT;

-- Guards against double-sends within a week and aids observability.
ALTER TABLE "users" ADD COLUMN "lastDigestSentAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_unsubscribeToken_key" ON "users"("unsubscribeToken");
