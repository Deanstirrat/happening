-- Resolve workflow for bug reports and event reports (issue #104). Both gain a
-- triage status; the admin nav badges count only unresolved (NEW / IN_PROGRESS).

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'RESOLVED');

-- AlterTable
ALTER TABLE "bug_reports" ADD COLUMN "status" "ReportStatus" NOT NULL DEFAULT 'NEW';
ALTER TABLE "event_reports" ADD COLUMN "status" "ReportStatus" NOT NULL DEFAULT 'NEW';

-- CreateIndex
CREATE INDEX "bug_reports_status_idx" ON "bug_reports"("status");
CREATE INDEX "event_reports_status_idx" ON "event_reports"("status");
