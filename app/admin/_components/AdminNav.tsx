import { prisma } from "@/lib/prisma";
import Link from "next/link";

interface Props {
  current: string;
}

const navItems = [
  { key: "metrics", label: "metrics", href: "/admin/metrics" },
  { key: "costs", label: "costs", href: "/admin/costs" },
  { key: "submissions", label: "submissions", href: "/admin/submissions" },
  { key: "curation", label: "curation", href: "/admin/curation" },
  { key: "events", label: "events", href: "/admin/events" },
  { key: "blocklist", label: "blocklist", href: "/admin/blocklist" },
  { key: "scrapers", label: "scrapers", href: "/admin/scrapers" },
  { key: "reports", label: "reports", href: "/admin/reports" },
  { key: "users", label: "users", href: "/admin/users" },
  { key: "audit", label: "audit", href: "/admin/audit" },
];

// Pages that map to the "reports" nav item
const reportsKeys = new Set(["reports", "feature-requests", "bug-reports", "event-reports"]);

export default async function AdminNav({ current }: Props) {
  const [pendingCount, newRequestCount, eventReportCount, bugReportCount] = await Promise.all([
    prisma.event.count({ where: { status: "PENDING" } }),
    prisma.featuredRequest.count({ where: { status: "NEW" } }),
    prisma.eventReport.count(),
    prisma.bugReport.count(),
  ]);

  const badges: Record<string, number> = {
    submissions: pendingCount,
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
