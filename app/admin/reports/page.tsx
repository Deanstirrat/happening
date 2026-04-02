export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { format } from "date-fns";
import Link from "next/link";
import { Suspense } from "react";
import AdminNav from "../_components/AdminNav";
import FeatureRequestActions from "../feature-requests/FeatureRequestActions";

interface Props {
  searchParams: Promise<{ secret?: string; tab?: string }>;
}

type Tab = "feature-requests" | "event-reports" | "bug-reports";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "feature-requests", label: "feature requests" },
  { key: "event-reports", label: "event reports" },
  { key: "bug-reports", label: "bug reports" },
];

const REQUEST_STATUS_LABELS = {
  NEW: "new",
  CONTACTED: "contacted",
  CLOSED: "closed",
};

const REQUEST_STATUS_COLORS = {
  NEW: "text-[#4ade80]",
  CONTACTED: "text-[#60a5fa]",
  CLOSED: "text-on-surface-variant",
};

export default async function ReportsPage({ searchParams }: Props) {
  const { secret, tab } = await searchParams;

  if (!secret || secret !== process.env.SCRAPE_SECRET) {
    return (
      <div className="max-w-screen-md mx-auto px-6 py-16 text-center">
        <p className="font-body text-on-surface-variant">Access denied.</p>
      </div>
    );
  }

  const activeTab: Tab =
    tab === "event-reports" || tab === "bug-reports" || tab === "feature-requests"
      ? tab
      : "feature-requests";

  const [featureRequests, eventReports, bugReports] = await Promise.all([
    activeTab === "feature-requests"
      ? prisma.featuredRequest.findMany({ orderBy: { createdAt: "desc" } })
      : prisma.featuredRequest.count({ where: { status: "NEW" } }),
    activeTab === "event-reports"
      ? prisma.eventReport.findMany({
          orderBy: { createdAt: "desc" },
          include: { event: { select: { id: true, title: true } } },
        })
      : prisma.eventReport.count(),
    activeTab === "bug-reports"
      ? prisma.bugReport.findMany({ orderBy: { createdAt: "desc" } })
      : prisma.bugReport.count(),
  ]);

  const featureRequestsCount =
    activeTab === "feature-requests"
      ? (featureRequests as Awaited<ReturnType<typeof prisma.featuredRequest.findMany>>).filter(
          (r) => r.status === "NEW"
        ).length
      : (featureRequests as number);
  const eventReportsCount =
    activeTab === "event-reports"
      ? (eventReports as Awaited<ReturnType<typeof prisma.eventReport.findMany>>).length
      : (eventReports as number);
  const bugReportsCount =
    activeTab === "bug-reports"
      ? (bugReports as Awaited<ReturnType<typeof prisma.bugReport.findMany>>).length
      : (bugReports as number);

  const tabBadges: Record<Tab, number> = {
    "feature-requests": featureRequestsCount,
    "event-reports": eventReportsCount,
    "bug-reports": bugReportsCount,
  };

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h1 className="font-headline font-black text-3xl text-on-surface lowercase">reports</h1>
        <AdminNav secret={secret} current="reports" />
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-2 flex-wrap">
        {TABS.map((t) => {
          const isActive = t.key === activeTab;
          const badge = tabBadges[t.key];
          return (
            <Link
              key={t.key}
              href={`/admin/reports?secret=${secret}&tab=${t.key}`}
              className={`font-body text-sm px-4 py-1.5 rounded-full transition-colors flex items-center gap-1.5 ${
                isActive
                  ? "bg-on-surface text-surface font-semibold"
                  : "bg-surface-container text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {t.label}
              {badge > 0 && (
                <span
                  className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none ${
                    isActive
                      ? "bg-surface text-on-surface"
                      : "bg-primary text-on-primary"
                  }`}
                >
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Feature Requests */}
      {activeTab === "feature-requests" && (() => {
        const requests = featureRequests as Awaited<ReturnType<typeof prisma.featuredRequest.findMany>>;
        return (
          <div className="flex flex-col gap-4">
            <p className="font-body text-on-surface-variant text-sm">
              {requests.length} request{requests.length !== 1 ? "s" : ""} received
            </p>
            {requests.length === 0 ? (
              <p className="font-body text-on-surface-variant">No requests yet.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {requests.map((req) => (
                  <div
                    key={req.id}
                    className="bg-surface-container rounded-2xl p-5 flex flex-col gap-3"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <h2 className="font-headline font-bold text-lg text-on-surface leading-tight">
                          {req.eventName}
                        </h2>
                        <p className="font-body text-on-surface-variant text-sm mt-0.5">
                          {req.name} · {req.email}
                          {req.eventDate && ` · ${req.eventDate}`}
                        </p>
                      </div>
                      <span
                        className={`font-body text-xs font-semibold shrink-0 ${REQUEST_STATUS_COLORS[req.status]}`}
                      >
                        {REQUEST_STATUS_LABELS[req.status]}
                      </span>
                    </div>
                    <p className="font-body text-sm text-on-surface">{req.message}</p>
                    {req.eventUrl && (
                      <a
                        href={req.eventUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-body text-xs text-on-surface-variant hover:text-on-surface underline truncate max-w-xs w-fit"
                      >
                        {req.eventUrl}
                      </a>
                    )}
                    <div className="flex items-center gap-3">
                      <span className="font-body text-xs text-on-surface-variant">
                        {format(req.createdAt, "MMM d yyyy, h:mma")}
                      </span>
                      <div className="ml-auto">
                        <Suspense>
                          <FeatureRequestActions id={req.id} status={req.status} secret={secret} />
                        </Suspense>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Event Reports */}
      {activeTab === "event-reports" && (() => {
        const reports = eventReports as Awaited<ReturnType<typeof prisma.eventReport.findMany<{ include: { event: { select: { id: true; title: true } } } }>>>;
        return (
          <div className="flex flex-col gap-4">
            <p className="font-body text-on-surface-variant text-sm">
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
                      <p className="font-body text-xs text-on-surface-variant italic">
                        no comment provided
                      </p>
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
                        href={`/admin/events/${report.event.id}/edit?secret=${secret}`}
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
        );
      })()}

      {/* Bug Reports */}
      {activeTab === "bug-reports" && (() => {
        const reports = bugReports as Awaited<ReturnType<typeof prisma.bugReport.findMany>>;
        return (
          <div className="flex flex-col gap-4">
            <p className="font-body text-on-surface-variant text-sm">
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
        );
      })()}
    </div>
  );
}
