-- CreateTable
CREATE TABLE "page_visits" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "page_visits_createdAt_idx" ON "page_visits"("createdAt");

-- CreateIndex
CREATE INDEX "page_visits_sessionId_idx" ON "page_visits"("sessionId");
