export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { format } from "date-fns";
import AdminNav from "../_components/AdminNav";

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
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-8 flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <h1 className="font-headline font-black text-3xl text-on-surface lowercase">bug reports</h1>
        <AdminNav secret={secret} current="bug-reports" />
      </div>

      <div>
        <p className="font-body text-on-surface-variant text-sm mb-6">
          {reports.length} report{reports.length !== 1 ? "s" : ""} submitted
        </p>

        {reports.length === 0 ? (
          <p className="font-body text-on-surface-variant">No bug reports yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {reports.map((report) => (
              <div
                key={report.id}
                className="bg-surface-container rounded-2xl p-5 flex flex-col gap-2"
              >
                <p className="font-body text-sm text-on-surface">{report.description}</p>
                <div className="flex flex-wrap gap-3 text-xs font-body text-on-surface-variant">
                  <span>{format(report.createdAt, "MMM d yyyy, h:mma")}</span>
                  {report.pageUrl && (
                    <a
                      href={report.pageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-on-surface underline truncate max-w-xs"
                    >
                      {report.pageUrl}
                    </a>
                  )}
                </div>
                {report.userAgent && (
                  <p className="font-body text-xs text-on-surface-variant truncate">
                    {report.userAgent}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
