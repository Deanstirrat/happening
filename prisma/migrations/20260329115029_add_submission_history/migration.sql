-- CreateEnum
CREATE TYPE "SubmissionOutcome" AS ENUM ('CREATED', 'DUPLICATE', 'ERROR');

-- CreateTable
CREATE TABLE "submissions" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "outcome" "SubmissionOutcome" NOT NULL,
    "eventId" TEXT,
    "submitterNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "submissions_createdAt_idx" ON "submissions"("createdAt");
