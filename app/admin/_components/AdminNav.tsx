import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { isServiceAreaTBA } from "@/lib/venues";

interface Props {
  current: string;
}

const navItems = [
  { key: "metrics", label: "metrics", href: "/admin/metrics" },
  { key: "costs", label: "costs", href: "/admin/costs" },
  { key: "submissions", label: "submissions", href: "/admin/submissions" },
  { key: "curation", label: "curation", href: "/admin/curation" },
  { key: "events", label: "events", href: "/admin/events" },
  { key: "duplicates", label: "duplicates", href: "/admin/duplicates" },
  { key: "ungeocoded", label: "ungeocoded", href: "/admin/ungeocoded" },
  { key: "blocklist", label: "blocklist", href: "/admin/blocklist" },
  { key: "scrapers", label: "scrapers", href: "/admin/scrapers" },
  { key: "reports", label: "reports", href: "/admin/reports" },
  { key: "users", label: "users", href: "/admin/users" },
  { key: "audit", label: "audit", href: "/admin/audit" },
];

// Pages that map to the "reports" nav item
const reportsKeys = new Set(["reports", "feature-requests", "bug-reports", "event-reports"]);

export default async function AdminNav({ current }: Props) {
  const [pendingCount, ungeocodedRows, newRequestCount, eventReportCount, bugReportCount] =
    await Promise.all([
      prisma.event.count({ where: { status: "PENDING" } }),
      // Future events live without coordinates — surfaced for venue-mapping triage.
      // Match the Ungeocoded page's own filter (PUBLISHED|PENDING) so the badge
      // counts what the page actually shows; ARCHIVED/REJECTED rows are hidden
      // there and shouldn't inflate the count. Fetch venueNames so we can drop
      // location-TBA events (intentionally locationless, not a geocoding failure)
      // the same way the page does.
      prisma.event.findMany({
        where: {
          geocoded: false,
          startDate: { gte: new Date() },
          status: { in: ["PUBLISHED", "PENDING"] },
        },
        select: { venueName: true },
      }),
      prisma.featuredRequest.count({ where: { status: "NEW" } }),
      // Badges count only unresolved reports (issue #104).
      prisma.eventReport.count({ where: { status: { not: "RESOLVED" } } }),
      prisma.bugReport.count({ where: { status: { not: "RESOLVED" } } }),
    ]);
  const ungeocodedCount = ungeocodedRows.filter(
    (e) => !isServiceAreaTBA(e.venueName)
  ).length;

  const badges: Record<string, number> = {
    submissions: pendingCount,
    ungeocoded: ungeocodedCount,
    reports: newRequestCount + eventReportCount + bugReportCount,
  };

  return (
    <div className="flex flex-wrap gap-4 font-body text-xs text-on-surface-variant border-b border-outline-variant pb-4">
      {navItems.map((item) => {
        const badge = badges[item.key] ?? 0;
        const isActive = item.key === current || (item.key === "reports" && reportsKeys.has(current));
        return (
          <Link
            key={item.key}
            href={item.href}
            className={`flex items-center gap-1 transition-colors ${
              isActive
                ? "text-on-surface font-semibold"
                : "hover:text-on-surface"
            }`}
          >
            {item.label}
            {badge > 0 && (
              <span className="bg-primary text-on-primary text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                {badge}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
