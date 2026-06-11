-- Open magic-link signup beyond editors (issue #96).

-- Self-serve signups default to USER. Existing rows keep their stored role;
-- only the column default changes for inserts that don't specify a role.
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'USER';

-- Attribute anonymous interest votes to an account once the session is claimed
-- on first login. Null = still anonymous; nulled on user delete so the
-- anonymous demand signal survives account deletion.
ALTER TABLE "event_interests" ADD COLUMN "userId" TEXT;

CREATE INDEX "event_interests_userId_idx" ON "event_interests"("userId");

ALTER TABLE "event_interests" ADD CONSTRAINT "event_interests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
