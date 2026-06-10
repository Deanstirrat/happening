export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { format, subHours, startOfHour, addDays } from "date-fns";
import Link from "next/link";
import AdminNav from "../_components/AdminNav";
import VisitorLineChart from "./VisitorLineChart";
import { sfDayKey, sfDayStart } from "@/lib/sfDate";

interface Props {
  searchParams: Promise<{ secret?: string; window?: string; chartWin?: string }>;
}

function windowLabel(w: string) {
  if (w === "30") return "30d";
  if (w === "all") return "all";
  return "7d";
}

function wowDelta(current: number, prev: number): { text: string; dir: "up" | "down" | "flat" } | null {
  if (prev === 0) return null;
  const pct = ((current - prev) / prev) * 100;
  if (Math.abs(pct) < 1) return { text: "~0%", dir: "flat" };
  return { text: `${pct > 0 ? "+" : ""}${Math.round(pct)}%`, dir: pct > 0 ? "up" : "down" };
}

function normalizePath(path: string): string {
  if (/^\/events\/[a-zA-Z0-9]+/.test(path)) return "/events/:id";
  return path;
}

function pathLabel(path: string): string {
  const labels: Record<string, string> = {
    "/": "/ · events list (home)",
    "/events/:id": "/events/:id · event detail",
    "/events": "/events · events list (legacy → /)",
    "/map": "/map · map",
    "/submit": "/submit · submit",
    "/login": "/login · login",
    "/spotify/connecting": "/spotify/connecting",
  };
  return labels[path] ?? path;
}

export default async function MetricsPage({ searchParams }: Props) {
  const { secret, window: win = "7", chartWin = "48" } = await searchParams;
  const chartHours = chartWin === "24" ? 24 : chartWin === "168" ? 168 : 48;

  if (!secret || secret !== process.env.SCRAPE_SECRET) {
    return (
      <div className="max-w-screen-md mx-auto px-6 py-16 text-center">
        <p className="font-body text-on-surface-variant">Access denied.</p>
      </div>
    );
  }

  const windowDays = win === "all" ? null : win === "30" ? 30 : 7;
  const now = new Date();
  const since = windowDays ? new Date(Date.now() - windowDays * 86400_000) : null;
  const prevSince = windowDays ? new Date(Date.now() - 2 * windowDays * 86400_000) : null;

  const todayStart = sfDayStart(sfDayKey(now));
  const weekAgo = new Date(now.getTime() - 7 * 86400_000);
  const next7dEnd = addDays(todayStart, 7);
  const next30dEnd = addDays(todayStart, 30);
  const chartStart = subHours(startOfHour(now), chartHours - 1);

  const [
    featuredEvents,
    windowVisits,
    chartVisits,
    prevWindowVisits,
    upcoming7dCount,
    upcoming30dCount,
    addedTodayCount,
    addedThisWeekCount,
    next7DayRaw,
    topViewsByEvent,
    submissionsCount,
    bugReportsCount,
    eventReportsCount,
    interestVotes,
    topInterestByEvent,
  ] = await Promise.all([
    prisma.event.findMany({
      where: { status: "PUBLISHED", featured: true, startDate: { gte: todayStart } },
      orderBy: { featuredAt: "desc" },
      select: {
        id: true, title: true, startDate: true, venueName: true,
        neighborhood: true, featuredAt: true,
        interactions: {
          ...(since && { where: { createdAt: { gte: since } } }),
          select: { type: true, sessionId: true },
        },
      },
    }),
    prisma.pageVisit.findMany({
      where: since ? { createdAt: { gte: since } } : {},
      select: { sessionId: true, path: true, createdAt: true },
    }),
    prisma.pageVisit.findMany({
      where: { createdAt: { gte: chartStart } },
      select: { sessionId: true, createdAt: true },
    }),
    prevSince && since
      ? prisma.pageVisit.findMany({
          where: { createdAt: { gte: prevSince, lt: since } },
          select: { sessionId: true },
        })
      : Promise.resolve([] as { sessionId: string }[]),
    prisma.event.count({ where: { status: "PUBLISHED", startDate: { gte: now, lt: next7dEnd } } }),
    prisma.event.count({ where: { status: "PUBLISHED", startDate: { gte: now, lt: next30dEnd } } }),
    prisma.event.count({ where: { scrapedAt: { gte: todayStart } } }),
    prisma.event.count({ where: { scrapedAt: { gte: weekAgo } } }),
    prisma.event.findMany({
      where: { status: "PUBLISHED", startDate: { gte: todayStart, lt: next7dEnd } },
      select: { startDate: true },
    }),
    prisma.eventInteraction.groupBy({
      by: ["eventId"],
      where: { type: "VIEW", ...(since ? { createdAt: { gte: since } } : {}) },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 5,
    }),
    prisma.submission.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.bugReport.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.eventReport.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.eventInterest.findMany({
      where: since ? { createdAt: { gte: since } } : {},
      select: { sessionId: true },
    }),
    prisma.eventInterest.groupBy({
      by: ["eventId"],
      where: since ? { createdAt: { gte: since } } : {},
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 10,
    }),
  ]);

  // Top event details (sequential — needs IDs from above)
  const topEventIds = topViewsByEvent.map((r) => r.eventId);
  const topEventDetails = topEventIds.length > 0
    ? await prisma.event.findMany({
        where: { id: { in: topEventIds } },
        select: { id: true, title: true, startDate: true, venueName: true },
      })
    : [];
  const topEventsWithCounts = topViewsByEvent
    .map((r) => ({ ...topEventDetails.find((e) => e.id === r.eventId), views: r._count.id }))
    .filter((e): e is typeof e & { id: string; title: string; startDate: Date } => !!e.id);

  // ── Traffic stats ──────────────────────────────────────────────────────────
  const totalVisits = windowVisits.length;
  const uniqueVisitors = new Set(windowVisits.map((v) => v.sessionId)).size;
  const daysInWindow = windowDays ?? Math.max(
    1,
    Math.ceil((Date.now() - (windowVisits.at(-1)?.createdAt.getTime() ?? Date.now())) / 86400_000)
  );
  const avgDaily = (totalVisits / daysInWindow).toFixed(1);
  const prevTotal = prevWindowVisits.length;
  const prevUnique = new Set(prevWindowVisits.map((v) => v.sessionId)).size;
  const visitsDelta = wowDelta(totalVisits, prevTotal);
  const uniqueDelta = wowDelta(uniqueVisitors, prevUnique);

  // ── Top pages ─────────────────────────────────────────────────────────────
  const pageMap = new Map<string, number>();
  for (const v of windowVisits) {
    const p = normalizePath(v.path);
    pageMap.set(p, (pageMap.get(p) ?? 0) + 1);
  }
  const topPages = [...pageMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([path, count]) => ({
      path,
      count,
      pct: totalVisits > 0 ? Math.round((count / totalVisits) * 100) : 0,
    }));

  // ── Hourly chart ──────────────────────────────────────────────────────────
  const hourlyMap = new Map<string, { visits: number; uniqueSessions: Set<string> }>();
  for (let i = 0; i < chartHours; i++) {
    const h = subHours(startOfHour(now), chartHours - 1 - i);
    hourlyMap.set(h.toISOString(), { visits: 0, uniqueSessions: new Set() });
  }
  for (const v of chartVisits) {
    const key = startOfHour(v.createdAt).toISOString();
    const entry = hourlyMap.get(key);
    if (entry) { entry.visits++; entry.uniqueSessions.add(v.sessionId); }
  }
  const hourlyChartData = Array.from(hourlyMap.entries()).map(([hour, d]) => ({
    hour, visits: d.visits, unique: d.uniqueSessions.size,
  }));

  // ── Daily chart (30d/all) ─────────────────────────────────────────────────
  const dailyChartDays = windowDays ?? Math.min(90, daysInWindow + 1);
  const dailyMap = new Map<string, { visits: number; uniqueSessions: Set<string> }>();
  for (let i = dailyChartDays - 1; i >= 0; i--) {
    const key = sfDayKey(new Date(Date.now() - i * 86400_000));
    if (!dailyMap.has(key)) dailyMap.set(key, { visits: 0, uniqueSessions: new Set() });
  }
  for (const v of windowVisits) {
    const key = sfDayKey(v.createdAt);
    const entry = dailyMap.get(key);
    if (entry) { entry.visits++; entry.uniqueSessions.add(v.sessionId); }
  }
  const dailyChartData = Array.from(dailyMap.entries()).map(([day, d]) => ({
    hour: sfDayStart(day).toISOString(),
    visits: d.visits,
    unique: d.uniqueSessions.size,
  }));

  // ── Event cadence: next 7 days ─────────────────────────────────────────────
  const cadenceMap = new Map<string, number>();
  for (let i = 0; i < 7; i++) {
    cadenceMap.set(sfDayKey(addDays(todayStart, i)), 0);
  }
  for (const e of next7DayRaw) {
    const key = sfDayKey(e.startDate);
    if (cadenceMap.has(key)) cadenceMap.set(key, cadenceMap.get(key)! + 1);
  }
  const cadenceDays = [...cadenceMap.entries()].map(([day, count]) => ({
    day,
    count,
    label: new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(sfDayStart(day)),
  }));
  const maxCadence = Math.max(...cadenceDays.map((d) => d.count), 1);

  // ── Featured event stats ───────────────────────────────────────────────────
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

  // ── In-app interest ────────────────────────────────────────────────────────
  const totalInterestVotes = interestVotes.length;
  const uniqueInterested = new Set(interestVotes.map((v) => v.sessionId)).size;
  const eventsWithInterest = topInterestByEvent.length;
  const interestEventIds = topInterestByEvent.map((r) => r.eventId);
  const interestEventDetails = interestEventIds.length > 0
    ? await prisma.event.findMany({
        where: { id: { in: interestEventIds } },
        select: { id: true, title: true, startDate: true, venueName: true, externalInterest: true },
      })
    : [];
  const topInterestEvents = topInterestByEvent
    .map((r) => ({
      ...interestEventDetails.find((e) => e.id === r.eventId),
      votes: r._count.id,
    }))
    .filter((e): e is typeof e & { id: string; title: string; startDate: Date } => !!e.id);

  const base = `/admin/metrics?secret=${secret}`;
  const winTabs = [
    { label: "7d", value: "7" },
    { label: "30d", value: "30" },
    { label: "all", value: "all" },
  ];

  const useDailyChart = windowDays === null || windowDays >= 30;
  const chartData = useDailyChart ? dailyChartData : hourlyChartData;
  const chartLabelStep = useDailyChart
    ? Math.max(1, Math.round(dailyChartDays / 6))
    : chartWin === "168" ? 24 : 6;

  function DeltaBadge({ d }: { d: ReturnType<typeof wowDelta> }) {
    if (!d) return null;
    const cls =
      d.dir === "up" ? "bg-green-900/40 text-green-400" :
      d.dir === "down" ? "bg-red-900/40 text-red-400" :
      "bg-surface-container-high text-on-surface-variant";
    return (
      <span className={`font-body text-[11px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>
        {d.text}
      </span>
    );
  }

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-8 flex flex-col gap-10">

      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <h1 className="font-headline font-black text-3xl text-on-surface lowercase">metrics</h1>
          <div className="flex gap-1 bg-surface-container rounded-xl p-1">
            {winTabs.map((t) => (
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

      {/* ── Site Traffic ─────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-5">
        <h2 className="font-headline font-bold text-xl text-on-surface lowercase">site traffic</h2>

        <div className="grid grid-cols-3 gap-4">
          {(
            [
              { label: "page visits", value: totalVisits.toLocaleString(), d: visitsDelta },
              { label: "unique visitors", value: uniqueVisitors.toLocaleString(), d: uniqueDelta },
              { label: "avg / day", value: avgDaily, d: null },
            ] as const
          ).map(({ label, value, d }) => (
            <div key={label} className="bg-surface-container rounded-2xl p-5">
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="font-headline font-black text-3xl text-on-surface">{value}</p>
                {d && <DeltaBadge d={d} />}
              </div>
              <p className="font-body text-xs text-on-surface-variant">
                {label}
                {d && windowDays && (
                  <span className="opacity-50"> · vs prev {windowLabel(win)}</span>
                )}
              </p>
            </div>
          ))}
        </div>

        {/* Chart */}
        <div className="bg-surface-container rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="font-body text-xs text-on-surface-variant">
              {useDailyChart
                ? `visits by day — last ${windowDays ?? dailyChartDays} days`
                : `visits by hour — last ${chartWin === "24" ? "24 hours" : chartWin === "168" ? "7 days" : "48 hours"}`}
            </p>
            {!useDailyChart && (
              <div className="flex gap-1 bg-surface-container-high rounded-lg p-0.5">
                {(["24", "48", "168"] as const).map((v) => (
                  <Link
                    key={v}
                    href={`${base}&window=${win}&chartWin=${v}`}
                    className={`px-2.5 py-1 rounded-md font-body text-[11px] transition-colors ${
                      chartWin === v
                        ? "bg-surface-container-highest text-on-surface font-semibold"
                        : "text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    {v === "168" ? "7d" : `${v}h`}
                  </Link>
                ))}
              </div>
            )}
          </div>
          <VisitorLineChart data={chartData} xLabelStep={chartLabelStep} mode={useDailyChart ? "daily" : "hourly"} />
        </div>

        {/* Top pages */}
        {topPages.length > 0 && (
          <div className="bg-surface-container rounded-2xl p-5">
            <p className="font-body text-xs text-on-surface-variant mb-4">top pages</p>
            <div className="flex flex-col gap-3">
              {topPages.map(({ path, count, pct }) => (
                <div key={path} className="flex items-center gap-3">
                  <span className="font-body text-xs text-on-surface-variant w-48 shrink-0 truncate">
                    {pathLabel(path)}
                  </span>
                  <div className="flex-1 h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                    <div className="h-full bg-primary/60 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="font-body text-xs text-on-surface tabular-nums w-24 text-right shrink-0">
                    {count.toLocaleString()} <span className="text-on-surface-variant">· {pct}%</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Content Health ────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-5">
        <h2 className="font-headline font-bold text-xl text-on-surface lowercase">content health</h2>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "upcoming · 7 days", value: upcoming7dCount.toLocaleString() },
            { label: "upcoming · 30 days", value: upcoming30dCount.toLocaleString() },
            { label: "added today", value: addedTodayCount.toLocaleString() },
            { label: "added this week", value: addedThisWeekCount.toLocaleString() },
          ].map(({ label, value }) => (
            <div key={label} className="bg-surface-container rounded-2xl p-5">
              <p className="font-headline font-black text-3xl text-on-surface">{value}</p>
              <p className="font-body text-xs text-on-surface-variant mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* Event cadence */}
        <div className="bg-surface-container rounded-2xl p-5">
          <p className="font-body text-xs text-on-surface-variant mb-4">event cadence — next 7 days</p>
          <div className="flex flex-col gap-3">
            {cadenceDays.map(({ label, count }) => {
              const barPct = Math.round((count / maxCadence) * 100);
              const isLow = count < 10;
              return (
                <div key={label} className="flex items-center gap-3">
                  <span className="font-body text-xs text-on-surface-variant w-24 shrink-0">{label}</span>
                  <div className="flex-1 h-4 bg-surface-container-high rounded-md overflow-hidden">
                    <div
                      className={`h-full rounded-md ${isLow ? "bg-red-500/50" : "bg-primary/50"}`}
                      style={{ width: count > 0 ? `${Math.max(barPct, 2)}%` : "0%" }}
                    />
                  </div>
                  <span className={`font-body text-xs tabular-nums w-8 text-right shrink-0 ${isLow ? "text-red-400" : "text-on-surface"}`}>
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Top Events ───────────────────────────────────────────────────────── */}
      {topEventsWithCounts.length > 0 && (
        <section>
          <h2 className="font-headline font-bold text-xl text-on-surface lowercase mb-4">
            top events · {windowLabel(win)}
          </h2>
          <div className="bg-surface-container rounded-2xl overflow-hidden">
            <table className="w-full font-body text-sm">
              <thead>
                <tr className="border-b border-outline-variant">
                  <th className="text-left px-5 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide">event</th>
                  <th className="text-right px-5 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide">views</th>
                </tr>
              </thead>
              <tbody>
                {topEventsWithCounts.map((ev, i) => (
                  <tr key={ev.id} className={i < topEventsWithCounts.length - 1 ? "border-b border-outline-variant" : ""}>
                    <td className="px-5 py-4">
                      <Link href={`/events/${ev.id}`} className="font-semibold text-on-surface hover:text-primary transition-colors line-clamp-1">
                        {ev.title}
                      </Link>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        {format(ev.startDate, "EEE, MMM d")}
                        {ev.venueName && ` · ${ev.venueName}`}
                      </p>
                    </td>
                    <td className="text-right px-5 py-4 text-on-surface tabular-nums font-semibold">
                      {ev.views.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Featured Event Performance ───────────────────────────────────────── */}
      <section>
        <h2 className="font-headline font-bold text-xl text-on-surface lowercase mb-4">
          featured event performance
        </h2>
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
                  <th className="text-left px-5 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide">event</th>
                  <th className="text-right px-4 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide">views</th>
                  <th className="text-right px-4 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide">clicks</th>
                  <th className="text-right px-4 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide">ctr</th>
                  <th className="text-right px-5 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide hidden lg:table-cell">uniq sessions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.id} className={i < rows.length - 1 ? "border-b border-outline-variant" : ""}>
                    <td className="px-5 py-4">
                      <Link href={`/events/${row.id}`} className="font-semibold text-on-surface hover:text-primary transition-colors line-clamp-1">
                        {row.title}
                      </Link>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        {format(row.startDate, "EEE, MMM d")}
                        {row.venueName && ` · ${row.venueName}`}
                        {row.neighborhood && ` · ${row.neighborhood}`}
                        {row.featuredAt && (
                          <span className="ml-2 opacity-60">featured {format(row.featuredAt, "MMM d")}</span>
                        )}
                      </p>
                    </td>
                    <td className="text-right px-4 py-4 text-on-surface tabular-nums">{row.views.toLocaleString()}</td>
                    <td className="text-right px-4 py-4 text-on-surface tabular-nums">{row.clicks.toLocaleString()}</td>
                    <td className="text-right px-4 py-4 text-on-surface-variant tabular-nums">{row.ctr === "—" ? "—" : `${row.ctr}%`}</td>
                    <td className="text-right px-5 py-4 text-on-surface-variant tabular-nums hidden lg:table-cell">{row.uniqueSessions.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Interest ─────────────────────────────────────────────────────────── */}
      <section>
        <h2 className="font-headline font-bold text-xl text-on-surface lowercase mb-4">
          interest · {windowLabel(win)}
        </h2>
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: "interested clicks", value: totalInterestVotes.toLocaleString() },
            { label: "unique people", value: uniqueInterested.toLocaleString() },
            { label: "events with interest", value: eventsWithInterest.toLocaleString() },
          ].map(({ label, value }) => (
            <div key={label} className="bg-surface-container rounded-2xl p-5">
              <p className="font-headline font-black text-3xl text-on-surface">{value}</p>
              <p className="font-body text-xs text-on-surface-variant mt-1">{label}</p>
            </div>
          ))}
        </div>
        {topInterestEvents.length === 0 ? (
          <p className="font-body text-on-surface-variant text-sm">No in-app interest yet.</p>
        ) : (
          <div className="bg-surface-container rounded-2xl overflow-hidden">
            <table className="w-full font-body text-sm">
              <thead>
                <tr className="border-b border-outline-variant">
                  <th className="text-left px-5 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide">event</th>
                  <th className="text-right px-4 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide">interested</th>
                  <th className="text-right px-5 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide hidden lg:table-cell">external</th>
                </tr>
              </thead>
              <tbody>
                {topInterestEvents.map((ev, i) => (
                  <tr key={ev.id} className={i < topInterestEvents.length - 1 ? "border-b border-outline-variant" : ""}>
                    <td className="px-5 py-4">
                      <Link href={`/events/${ev.id}`} className="font-semibold text-on-surface hover:text-primary transition-colors line-clamp-1">
                        {ev.title}
                      </Link>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        {format(ev.startDate, "EEE, MMM d")}
                        {ev.venueName && ` · ${ev.venueName}`}
                      </p>
                    </td>
                    <td className="text-right px-4 py-4 text-on-surface tabular-nums font-semibold">{ev.votes.toLocaleString()}</td>
                    <td className="text-right px-5 py-4 text-on-surface-variant tabular-nums hidden lg:table-cell">
                      {(ev.externalInterest ?? 0).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Pipeline ─────────────────────────────────────────────────────────── */}
      <section>
        <h2 className="font-headline font-bold text-xl text-on-surface lowercase mb-4">
          pipeline · last 7 days
        </h2>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "submissions", value: submissionsCount, href: `/admin/submissions?secret=${secret}` },
            { label: "bug reports", value: bugReportsCount, href: `/admin/bug-reports?secret=${secret}` },
            { label: "event reports", value: eventReportsCount, href: `/admin/event-reports?secret=${secret}` },
          ].map(({ label, value, href }) => (
            <Link
              key={label}
              href={href}
              className="bg-surface-container rounded-2xl p-5 hover:bg-surface-container-high transition-colors"
            >
              <p className={`font-headline font-black text-3xl ${value > 0 ? "text-on-surface" : "text-on-surface-variant"}`}>
                {value}
              </p>
              <p className="font-body text-xs text-on-surface-variant mt-1">{label}</p>
            </Link>
          ))}
        </div>
      </section>

    </div>
  );
}
