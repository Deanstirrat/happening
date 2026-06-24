-- Add a one-line "why we featured it" blurb to events. Nullable and additive:
-- old code ignores it, new code reads it, so it is safe to apply before the
-- new server starts (scripts/start.sh runs `prisma migrate deploy` first).
ALTER TABLE "events" ADD COLUMN "featuredBlurb" TEXT;
