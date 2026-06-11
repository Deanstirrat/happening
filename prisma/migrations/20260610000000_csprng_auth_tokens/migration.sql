-- Tokens are now generated in application code with a CSPRNG
-- (crypto.randomBytes), so drop the cuid() column defaults.
ALTER TABLE "user_sessions" ALTER COLUMN "token" DROP DEFAULT;
ALTER TABLE "magic_link_tokens" ALTER COLUMN "token" DROP DEFAULT;

-- Invalidate existing bearer credentials that were minted with the
-- predictable cuid() default. Active editors will re-authenticate via
-- magic link.
DELETE FROM "user_sessions";
DELETE FROM "magic_link_tokens";
