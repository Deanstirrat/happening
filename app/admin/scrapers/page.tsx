export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import AdminNav from "../_components/AdminNav";

interface Props {
  searchParams: Promise<{ secret?: string }>;
}

function relativeTime(date: Date | null): string {
  if (!date) return "Never";
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

const SCRAPE_TYPE_STYLES: Record<string, string> = {
  CHEERIO: "bg-[#0d3349] text-[#5db8e8]",
  PLAYWRIGHT: "bg-[#2d1b4e] text-[#b388f8]",
  API: "bg-[#0d3323] text-[#4caf7d]",
  MANUAL: "bg-surface-container text-on-surface-variant",
};

export default async function ScrapersPage({ searchParams }: Props) {
  const { secret } = await searchParams;

  if (!secret || secret !== process.env.SCRAPE_SECRET) {
    return (
      <div className="max-w-screen-md mx-auto px-6 py-16 text-center">
        <p className="font-body text-on-surface-variant">Access denied.</p>
      </div>
    );
  }

  const now = new Date();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000);

  const [sources, upcomingBySource, recentBySource] = await Promise.all([
    prisma.source.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { events: true } },
      },
    }),
    prisma.event.groupBy({
      by: ["sourceId"],
      where: { startDate: { gte: now } },
      _count: { id: true },
    }),
    prisma.event.groupBy({
      by: ["sourceId"],
      where: { scrapedAt: { gte: thirtyDaysAgo } },
      _count: { id: true },
    }),
  ]);

  const upcomingMap = new Map(upcomingBySource.map((r) => [r.sourceId, r._count.id]));
  const recentMap = new Map(recentBySource.map((r) => [r.sourceId, r._count.id]));

  const enabledCount = sources.filter((s) => s.enabled).length;

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-8 flex flex-col gap-10">
      {/* Header + nav */}
      <div className="flex flex-col gap-4">
        <h1 className="font-headline font-black text-3xl text-on-surface lowercase">scrapers</h1>
        <AdminNav secret={secret} current="scrapers" />
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "total sources", value: sources.length },
          { label: "enabled", value: enabledCount },
          { label: "disabled", value: sources.length - enabledCount },
        ].map(({ label, value }) => (
          <div key={label} className="bg-surface-container rounded-2xl p-5">
            <p className="font-headline font-black text-3xl text-on-surface">{value}</p>
            <p className="font-body text-xs text-on-surface-variant mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Sources table */}
      <section>
        <h2 className="font-headline font-bold text-xl text-on-surface lowercase mb-4">
          source status
        </h2>
        <div className="bg-surface-container rounded-2xl overflow-hidden">
          <table className="w-full font-body text-sm">
            <thead>
              <tr className="border-b border-outline-variant">
                <th className="text-left px-5 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide">
                  source
                </th>
                <th className="text-left px-4 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide hidden sm:table-cell">
                  type
                </th>
                <th className="text-right px-4 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide">
                  last scraped
                </th>
                <th className="text-right px-4 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide hidden md:table-cell">
                  30d new
                </th>
                <th className="text-right px-4 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide hidden md:table-cell">
                  upcoming
                </th>
                <th className="text-right px-5 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide hidden lg:table-cell">
                  total
                </th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source, i) => {
                const upcoming = upcomingMap.get(source.id) ?? 0;
                const recent = recentMap.get(source.id) ?? 0;
                const total = source._count.events;
                const typeStyle = SCRAPE_TYPE_STYLES[source.scrapeType] ?? SCRAPE_TYPE_STYLES.MANUAL;
                const isLast = i === sources.length - 1;

                return (
                  <tr key={source.id} className={!isLast ? "border-b border-outline-variant" : ""}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: source.enabled ? "#4caf7d" : "#555" }}
                        />
                        <div>
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-on-surface hover:text-primary transition-colors"
                          >
                            {source.name}
                          </a>
                          <p className="text-[0.65rem] text-on-surface-variant mt-0.5">
                            {source.slug}
                            {!source.enabled && (
                              <span className="ml-2 text-on-surface-variant opacity-60">disabled</span>
                            )}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 hidden sm:table-cell">
                      <span className={`text-[0.65rem] font-semibold px-2 py-0.5 rounded-full ${typeStyle}`}>
                        {source.scrapeType}
                      </span>
                    </td>
                    <td className="text-right px-4 py-4 text-on-surface-variant tabular-nums text-xs">
                      {relativeTime(source.lastScrapedAt)}
                    </td>
                    <td className="text-right px-4 py-4 text-on-surface tabular-nums hidden md:table-cell">
                      {recent.toLocaleString()}
                    </td>
                    <td className="text-right px-4 py-4 text-on-surface tabular-nums hidden md:table-cell">
                      {upcoming.toLocaleString()}
                    </td>
                    <td className="text-right px-5 py-4 text-on-surface-variant tabular-nums hidden lg:table-cell">
                      {total.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* How to trigger */}
      <section>
        <h2 className="font-headline font-bold text-xl text-on-surface lowercase mb-4">
          run scrapers
        </h2>
        <div className="bg-surface-container rounded-2xl p-5 font-body text-xs text-on-surface-variant flex flex-col gap-2">
          <p>Trigger a single scraper:</p>
          <pre className="bg-surface-container-high rounded px-3 py-2 text-on-surface overflow-x-auto">
            {`curl -X POST /api/scrape \\\n  -H "x-scrape-secret: $SCRAPE_SECRET" \\\n  -d '{"source":"foopee"}'`}
          </pre>
          <p className="mt-1">Run all scrapers:</p>
          <pre className="bg-surface-container-high rounded px-3 py-2 text-on-surface overflow-x-auto">
            {`curl -X POST /api/scrape \\\n  -H "x-scrape-secret: $SCRAPE_SECRET" \\\n  -d '{"source":"all"}'`}
          </pre>
        </div>
      </section>
    </div>
  );
}
