-- CreateTable
CREATE TABLE "instagram_seen_posts" (
    "shortCode" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instagram_seen_posts_pkey" PRIMARY KEY ("shortCode")
);
