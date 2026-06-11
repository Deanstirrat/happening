-- Follow venues, categories, and artists (issue #98).

-- CreateEnum
CREATE TYPE "FollowTargetType" AS ENUM ('VENUE', 'CATEGORY', 'ARTIST');

-- CreateTable
CREATE TABLE "follows" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetType" "FollowTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "follows_userId_idx" ON "follows"("userId");

-- CreateIndex
CREATE INDEX "follows_targetType_targetId_idx" ON "follows"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "follows_userId_targetType_targetId_key" ON "follows"("userId", "targetType", "targetId");

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
