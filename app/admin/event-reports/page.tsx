export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { format } from "date-fns";
import Link from "next/link";
import AdminNav from "../_components/AdminNav";
import { getAdminUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function EventReportsPage() {
  if (!(await getAdminUser())) redirect("/login");

  const reports = await prisma.eventReport.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      event: { select: { id: true, title: true } },
    },
  });

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-8 flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <h1 className="font-headline font-black text-3xl text-on-surface lowercase">event reports</h1>
        <AdminNav current="event-reports" />
      </div>

      <div>
        <p className="font-body text-on-surface-variant text-sm mb-6">
          {reports.length} report{reports.length !== 1 ? "s" : ""}
        </p>

        {reports.length === 0 ? (
          <p className="font-body text-on-surface-variant">No event reports yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {reports.map((report) => (
              <div
                key={report.id}
                className="bg-surface-container rounded-2xl p-5 flex flex-col gap-2"
              >
                <Link
                  href={`/events/${report.event.id}`}
                  target="_blank"
                  className="font-body font-semibold text-sm text-on-surface hover:text-primary transition-colors"
                >
                  {report.event.title}
                </Link>

                {report.comment ? (
                  <p className="font-body text-sm text-on-surface">{report.comment}</p>
                ) : (
                  <p className="font-body text-xs text-on-surface-variant italic">no comment provided</p>
                )}

                <div className="flex flex-wrap gap-3 text-xs font-body text-on-surface-variant">
                  <span>{format(report.createdAt, "MMM d yyyy, h:mma")}</span>
                  {report.email && (
                    <a
                      href={`mailto:${report.email}`}
                      className="hover:text-on-surface transition-colors"
                    >
                      {report.email}
                    </a>
                  )}
                  <Link
                    href={`/admin/events/${report.event.id}/edit`}
                    className="hover:text-on-surface transition-colors underline"
                  >
                    edit event
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
