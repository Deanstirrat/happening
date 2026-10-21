export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { format } from "date-fns";
import Link from "next/link";
import { Suspense } from "react";
import AdminNav from "../_components/AdminNav";
import FeatureRequestActions from "../feature-requests/FeatureRequestActions";
import { getAdminUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import ReportList, { type ReportItem } from "./ReportList";
import CorrectionList, { type CorrectionItem, type CorrectionDiff } from "./CorrectionList";
import { formatDateTimeSF } from "@/lib/sfDate";

interface Props {
  searchParams: Promise<{ tab?: string }>;
}

type Tab = "feature-requests" | "corrections" | "event-reports" | "bug-reports";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "feature-requests", label: "feature requests" },
  { key: "corrections", label: "corrections" },
  { key: "event-reports", label: "event reports" },
  { key: "bug-reports", label: "bug reports" },
];

const CORRECTION_FIELD_LABELS: Record<string, string> = {
  startDate: "Start",
  endDate: "End",
  allDay: "All day",
  venueName: "Venue",
  price: "Price",
  imageUrl: "Artwork",
  description: "Description",
  tags: "Tags",
};

// The linked-event fields a correction can touch, for rendering the current →
// suggested diff. Dates are formatted in SF time to match the rest of admin.
type CorrectionEvent = {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date | null;
  allDay: boolean;
  venueName: string | null;
  price: string | null;
  imageUrl: string | null;
  description: string | null;
  tags: string[];
};

function formatCorrectionValue(field: string, value: unknown): string {
  if (value == null || value === "") return "";
  if (field === "startDate" || field === "endDate") {
    const d = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(d.getTime()) ? String(value) : formatDateTimeSF(d);
  }
  if (field === "allDay") return value ? "yes" : "no";
  if (field === "tags") return Array.isArray(value) ? value.join(", ") : String(value);
  return String(value);
}

function buildCorrectionDiffs(
  edits: Record<string, unknown>,
  event: CorrectionEvent | undefined
): CorrectionDiff[] {
  return Object.entries(edits).map(([field, suggested]) => ({
    label: CORRECTION_FIELD_LABELS[field] ?? field,
    current: event
      ? formatCorrectionValue(field, (event as Record<string, unknown>)[field])
      : "",
    suggested: formatCorrectionValue(field, suggested),
  }));
}

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

const fmtDate = (d: Date) => format(d, "MMM d yyyy, h:mma");

export default async function ReportsPage({ searchParams }: Props) {
  if (!(await getAdminUser())) redirect("/login");

  const { tab } = await searchParams;

  const activeTab: Tab =
    tab === "event-reports" ||
    tab === "bug-reports" ||
    tab === "feature-requests" ||
    tab === "corrections"
      ? tab
      : "feature-requests";

  // Unresolved = NEW or IN_PROGRESS (and NEW for feature requests). Badges reflect
  // only unresolved items; the active tab loads full rows, inactive tabs just count.
  const [featureRequests, corrections, eventReports, bugReports] = await Promise.all([
    activeTab === "feature-requests"
      ? prisma.featuredRequest.findMany({ orderBy: { createdAt: "desc" } })
      : prisma.featuredRequest.count({ where: { status: "NEW" } }),
    activeTab === "corrections"
      ? prisma.eventCorrection.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }] })
      : prisma.eventCorrection.count({ where: { status: { not: "RESOLVED" } } }),
    activeTab === "event-reports"
      ? prisma.eventReport.findMany({
          orderBy: [{ status: "asc" }, { createdAt: "desc" }],
          include: { event: { select: { id: true, title: true } } },
        })
      : prisma.eventReport.count({ where: { status: { not: "RESOLVED" } } }),
    activeTab === "bug-reports"
      ? prisma.bugReport.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }] })
      : prisma.bugReport.count({ where: { status: { not: "RESOLVED" } } }),
  ]);

  // When the corrections tab is active, resolve each correction's linked event so
  // the diff can show current → suggested. One batched query over the linked ids.
  type CorrectionRow = Awaited<ReturnType<typeof prisma.eventCorrection.findMany>>[number];
  const correctionRows = activeTab === "corrections" ? (corrections as CorrectionRow[]) : [];
  const correctionEventMap = new Map<string, CorrectionEvent>();
  if (correctionRows.length > 0) {
    const events = await prisma.event.findMany({
      where: { id: { in: [...new Set(correctionRows.map((c) => c.eventId))] } },
      select: {
        id: true,
        title: true,
        startDate: true,
        endDate: true,
        allDay: true,
        venueName: true,
        price: true,
        imageUrl: true,
        description: true,
        tags: true,
      },
    });
    for (const e of events) correctionEventMap.set(e.id, e);
  }

  const featureRequestsCount =
    activeTab === "feature-requests"
      ? (featureRequests as Awaited<ReturnType<typeof prisma.featuredRequest.findMany>>).filter(
          (r) => r.status === "NEW"
        ).length
      : (featureRequests as number);
  const correctionsCount =
    activeTab === "corrections"
      ? correctionRows.filter((r) => r.status !== "RESOLVED").length
      : (corrections as number);
  const eventReportsCount =
    activeTab === "event-reports"
      ? (eventReports as Awaited<ReturnType<typeof prisma.eventReport.findMany>>).filter(
          (r) => r.status !== "RESOLVED"
        ).length
      : (eventReports as number);
  const bugReportsCount =
    activeTab === "bug-reports"
      ? (bugReports as Awaited<ReturnType<typeof prisma.bugReport.findMany>>).filter(
          (r) => r.status !== "RESOLVED"
        ).length
      : (bugReports as number);

  const tabBadges: Record<Tab, number> = {
    "feature-requests": featureRequestsCount,
    "corrections": correctionsCount,
    "event-reports": eventReportsCount,
    "bug-reports": bugReportsCount,
  };

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h1 className="font-headline font-black text-3xl text-on-surface lowercase">reports</h1>
        <AdminNav current="reports" />
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-2 flex-wrap">
        {TABS.map((t) => {
          const isActive = t.key === activeTab;
          const badge = tabBadges[t.key];
          return (
            <Link
              key={t.key}
              href={`/admin/reports?tab=${t.key}`}
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
                        {fmtDate(req.createdAt)}
                      </span>
                      <div className="ml-auto">
                        <Suspense>
                          <FeatureRequestActions id={req.id} status={req.status} hasLinkedEvent={false} />
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

      {/* Corrections */}
      {activeTab === "corrections" && (() => {
        const items: CorrectionItem[] = correctionRows.map((c) => ({
          id: c.id,
          status: c.status,
          createdAtLabel: fmtDate(c.createdAt),
          eventId: c.eventId,
          eventTitle: correctionEventMap.get(c.eventId)?.title ?? "(event removed)",
          isOrganizer: c.isOrganizer,
          comment: c.comment,
          email: c.email,
          diffs: buildCorrectionDiffs(
            (c.suggestedEdits as Record<string, unknown>) ?? {},
            correctionEventMap.get(c.eventId)
          ),
        }));
        return (
          <div className="flex flex-col gap-4">
            <p className="font-body text-on-surface-variant text-sm">
              {correctionRows.length} correction{correctionRows.length !== 1 ? "s" : ""} ·{" "}
              {correctionsCount} unresolved
            </p>
            <CorrectionList items={items} />
          </div>
        );
      })()}

      {/* Event Reports */}
      {activeTab === "event-reports" && (() => {
        const reports = eventReports as Awaited<
          ReturnType<typeof prisma.eventReport.findMany<{ include: { event: { select: { id: true; title: true } } } }>>
        >;
        const items: ReportItem[] = reports.map((r) => ({
          id: r.id,
          status: r.status,
          createdAtLabel: fmtDate(r.createdAt),
          eventId: r.event.id,
          eventTitle: r.event.title,
          comment: r.comment,
          email: r.email,
        }));
        return (
          <div className="flex flex-col gap-4">
            <p className="font-body text-on-surface-variant text-sm">
              {reports.length} report{reports.length !== 1 ? "s" : ""} · {eventReportsCount} unresolved
            </p>
            <ReportList kind="event" items={items} />
          </div>
        );
      })()}

      {/* Bug Reports */}
      {activeTab === "bug-reports" && (() => {
        const reports = bugReports as Awaited<ReturnType<typeof prisma.bugReport.findMany>>;
        const items: ReportItem[] = reports.map((r) => ({
          id: r.id,
          status: r.status,
          createdAtLabel: fmtDate(r.createdAt),
          description: r.description,
          pageUrl: r.pageUrl,
          userAgent: r.userAgent,
        }));
        return (
          <div className="flex flex-col gap-4">
            <p className="font-body text-on-surface-variant text-sm">
              {reports.length} report{reports.length !== 1 ? "s" : ""} submitted · {bugReportsCount}{" "}
              unresolved
            </p>
            <ReportList kind="bug" items={items} />
          </div>
        );
      })()}
    </div>
  );
}
