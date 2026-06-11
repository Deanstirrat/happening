-- New default role for self-serve magic-link signups (issue #96).
-- Adding the enum value lives in its own migration: Postgres forbids using a
-- newly added enum value (e.g. as a column default) in the same transaction
-- that adds it, so the value must be committed first.
ALTER TYPE "UserRole" ADD VALUE 'USER';
