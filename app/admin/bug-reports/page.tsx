export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { format } from "date-fns";
import AdminNav from "../_components/AdminNav";
import ReportList, { type ReportItem } from "../reports/ReportList";

interface Props {
  searchParams: Promise<{ secret?: string }>;
}

export default async function BugReportsPage({ searchParams }: Props) {
  const { secret } = await searchParams;

  if (!secret || secret !== process.env.SCRAPE_SECRET) {
    return (
      <div className="max-w-screen-md mx-auto px-6 py-16 text-center">
        <p className="font-body text-on-surface-variant">Access denied.</p>
      </div>
    );
  }

  const reports = await prisma.bugReport.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  const unresolved = reports.filter((r) => r.status !== "RESOLVED").length;

  const items: ReportItem[] = reports.map((r) => ({
    id: r.id,
    status: r.status,
    createdAtLabel: format(r.createdAt, "MMM d yyyy, h:mma"),
    description: r.description,
    pageUrl: r.pageUrl,
    userAgent: r.userAgent,
  }));

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-8 flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <h1 className="font-headline font-black text-3xl text-on-surface lowercase">bug reports</h1>
        <AdminNav secret={secret} current="bug-reports" />
      </div>

      <div>
        <p className="font-body text-on-surface-variant text-sm mb-6">
          {reports.length} report{reports.length !== 1 ? "s" : ""} submitted · {unresolved} unresolved
        </p>
        <ReportList kind="bug" items={items} secret={secret} />
      </div>
    </div>
  );
}
