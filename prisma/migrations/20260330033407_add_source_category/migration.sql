-- CreateEnum
CREATE TYPE "SourceCategory" AS ENUM ('AGGREGATOR', 'VENUE', 'INSTITUTIONAL', 'COMMUNITY');

-- AlterTable
ALTER TABLE "sources" ADD COLUMN     "category" "SourceCategory" NOT NULL DEFAULT 'AGGREGATOR';
