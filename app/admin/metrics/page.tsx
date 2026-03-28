export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { format, subHours, startOfHour } from "date-fns";
import Link from "next/link";
import AdminNav from "../_components/AdminNav";
import VisitorLineChart from "./VisitorLineChart";

interface Props {
  searchParams: Promise<{ secret?: string; window?: string }>;
}

function windowLabel(w: string) {
  if (w === "30") return "30d";
  if (w === "all") return "all";
  return "7d";
}

export default async function MetricsPage({ searchParams }: Props) {
  const { secret, window: win = "7" } = await searchParams;

  if (!secret || secret !== process.env.SCRAPE_SECRET) {
    return (
      <div className="max-w-screen-md mx-auto px-6 py-16 text-center">
        <p className="font-body text-on-surface-variant">Access denied.</p>
      </div>
    );
  }

  const windowDays = win === "all" ? null : win === "30" ? 30 : 7;
  const since = windowDays ? new Date(Date.now() - windowDays * 86400_000) : null;

  // Fetch page visits (windowed) + last 48h by hour for chart
  const chart48Start = subHours(startOfHour(new Date()), 47);

  const [featuredEvents, windowVisits, chartVisits] = await Promise.all([
    prisma.event.findMany({
      where: { status: "PUBLISHED", featured: true },
      orderBy: { featuredAt: "desc" },
      select: {
        id: true,
        title: true,
        startDate: true,
        venueName: true,
        neighborhood: true,
        featuredAt: true,
        interactions: {
          ...(since && { where: { createdAt: { gte: since } } }),
          select: { type: true, sessionId: true },
        },
      },
    }),
    prisma.pageVisit.findMany({
      where: since ? { createdAt: { gte: since } } : {},
      select: { sessionId: true, createdAt: true },
    }),
    prisma.pageVisit.findMany({
      where: { createdAt: { gte: chart48Start } },
      select: { sessionId: true, createdAt: true },
    }),
  ]);

  // Featured event stats
  const rows = featuredEvents.map((ev) => {
    const views = ev.interactions.filter((i) => i.type === "VIEW").length;
    const clicks = ev.interactions.filter((i) => i.type === "CLICK").length;
    const uniqueSessions = new Set(ev.interactions.map((i) => i.sessionId)).size;
    const ctr = views > 0 ? ((clicks / views) * 100).toFixed(1) : "—";
    return { ...ev, views, clicks, uniqueSessions, ctr };
  });

  const totalViews = rows.reduce((s, r) => s + r.views, 0);
  const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);
  const overallCtr = totalViews > 0 ? ((totalClicks / totalViews) * 100).toFixed(1) : "—";

  // Site traffic stats (windowed)
  const totalVisits = windowVisits.length;
  const uniqueVisitors = new Set(windowVisits.map((v) => v.sessionId)).size;
  const daysInWindow = windowDays ?? Math.max(1, Math.ceil((Date.now() - (windowVisits[windowVisits.length - 1]?.createdAt.getTime() ?? Date.now())) / 86400_000));
  const avgDaily = windowDays ? (totalVisits / windowDays).toFixed(1) : (totalVisits / Math.max(1, daysInWindow)).toFixed(1);

  // 48-hour hourly chart data
  const hourlyMap = new Map<string, { visits: number; uniqueSessions: Set<string> }>();
  for (let i = 0; i < 48; i++) {
    const h = subHours(startOfHour(new Date()), 47 - i);
    hourlyMap.set(h.toISOString(), { visits: 0, uniqueSessions: new Set() });
  }
  for (const v of chartVisits) {
    const key = startOfHour(v.createdAt).toISOString();
    const entry = hourlyMap.get(key);
    if (entry) {
      entry.visits++;
      entry.uniqueSessions.add(v.sessionId);
    }
  }
  const chartHours = Array.from(hourlyMap.entries()).map(([hour, data]) => ({
    hour,
    visits: data.visits,
    unique: data.uniqueSessions.size,
  }));

  const base = `/admin/metrics?secret=${secret}`;
  const tabs: { label: string; value: string }[] = [
    { label: "7d", value: "7" },
    { label: "30d", value: "30" },
    { label: "all", value: "all" },
  ];

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-8 flex flex-col gap-10">
      {/* Header + nav */}
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <h1 className="font-headline font-black text-3xl text-on-surface lowercase">metrics</h1>
          {/* Window tabs */}
          <div className="flex gap-1 bg-surface-container rounded-xl p-1">
            {tabs.map((t) => (
              <Link
                key={t.value}
                href={`${base}&window=${t.value}`}
                className={`px-3 py-1.5 rounded-lg font-body text-xs transition-colors ${
                  windowLabel(win) === t.label
                    ? "bg-primary text-on-primary font-semibold"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </div>
        </div>
        <AdminNav secret={secret} current="metrics" />
      </div>

      {/* Site traffic */}
      <section className="flex flex-col gap-5">
        <h2 className="font-headline font-bold text-xl text-on-surface lowercase">site traffic</h2>

        {/* Traffic stat cards */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "page visits", value: totalVisits.toLocaleString() },
            { label: "unique visitors", value: uniqueVisitors.toLocaleString() },
            { label: "avg / day", value: avgDaily },
          ].map(({ label, value }) => (
            <div key={label} className="bg-surface-container rounded-2xl p-5">
              <p className="font-headline font-black text-3xl text-on-surface">{value}</p>
              <p className="font-body text-xs text-on-surface-variant mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* 48-hour line chart */}
        <div className="bg-surface-container rounded-2xl p-5">
          <p className="font-body text-xs text-on-surface-variant mb-2">visits by hour — last 48 hours</p>
          <VisitorLineChart data={chartHours} label="" />
        </div>
      </section>

      {/* Featured event performance */}
      <section>
        <h2 className="font-headline font-bold text-xl text-on-surface lowercase mb-4">
          featured event performance
        </h2>

        {/* Summary stat cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: "impressions", value: totalViews.toLocaleString() },
            { label: "link clicks", value: totalClicks.toLocaleString() },
            { label: "click-through rate", value: overallCtr === "—" ? "—" : `${overallCtr}%` },
          ].map(({ label, value }) => (
            <div key={label} className="bg-surface-container rounded-2xl p-5">
              <p className="font-headline font-black text-3xl text-on-surface">{value}</p>
              <p className="font-body text-xs text-on-surface-variant mt-1">{label}</p>
            </div>
          ))}
        </div>

        {rows.length === 0 ? (
          <p className="font-body text-on-surface-variant text-sm">No featured events.</p>
        ) : (
          <div className="bg-surface-container rounded-2xl overflow-hidden">
            <table className="w-full font-body text-sm">
              <thead>
                <tr className="border-b border-outline-variant">
                  <th className="text-left px-5 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide">
                    event
                  </th>
                  <th className="text-right px-4 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide">
                    views
                  </th>
                  <th className="text-right px-4 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide">
                    clicks
                  </th>
                  <th className="text-right px-4 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide">
                    ctr
                  </th>
                  <th className="text-right px-5 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide">
                    uniq sessions
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={row.id}
                    className={i < rows.length - 1 ? "border-b border-outline-variant" : ""}
                  >
                    <td className="px-5 py-4">
                      <Link
                        href={`/events/${row.id}`}
                        className="font-semibold text-on-surface hover:text-primary transition-colors line-clamp-1"
                      >
                        {row.title}
                      </Link>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        {format(row.startDate, "EEE, MMM d")}
                        {row.venueName && ` · ${row.venueName}`}
                        {row.neighborhood && ` · ${row.neighborhood}`}
                        {row.featuredAt && (
                          <span className="ml-2 opacity-60">
                            featured {format(row.featuredAt, "MMM d")}
                          </span>
                        )}
                      </p>
                    </td>
                    <td className="text-right px-4 py-4 text-on-surface tabular-nums">
                      {row.views.toLocaleString()}
                    </td>
                    <td className="text-right px-4 py-4 text-on-surface tabular-nums">
                      {row.clicks.toLocaleString()}
                    </td>
                    <td className="text-right px-4 py-4 text-on-surface-variant tabular-nums">
                      {row.ctr === "—" ? "—" : `${row.ctr}%`}
                    </td>
                    <td className="text-right px-5 py-4 text-on-surface-variant tabular-nums">
                      {row.uniqueSessions.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
