import { prisma } from "@/lib/prisma";
import Link from "next/link";

interface Props {
  secret: string;
  current: string;
}

const navItems = [
  { key: "metrics", label: "metrics", href: "/admin/metrics" },
  { key: "submissions", label: "submissions", href: "/admin/submissions" },
  { key: "events", label: "events", href: "/admin/events" },
  { key: "feature-requests", label: "feature requests", href: "/admin/feature-requests" },
  { key: "bug-reports", label: "bug reports", href: "/admin/bug-reports" },
];

export default async function AdminNav({ secret, current }: Props) {
  const [pendingCount, newRequestCount] = await Promise.all([
    prisma.event.count({ where: { status: "PENDING" } }),
    prisma.featuredRequest.count({ where: { status: "NEW" } }),
  ]);

  const badges: Record<string, number> = {
    submissions: pendingCount,
    "feature-requests": newRequestCount,
  };

  return (
    <div className="flex flex-wrap gap-4 font-body text-xs text-on-surface-variant border-b border-outline-variant pb-4">
      {navItems.map((item) => {
        const badge = badges[item.key] ?? 0;
        const isActive = item.key === current;
        return (
          <Link
            key={item.key}
            href={`${item.href}?secret=${secret}`}
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
