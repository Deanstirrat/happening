export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import AdminNav from "../_components/AdminNav";
import { getAdminUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isServiceAreaTBA } from "@/lib/venues";

/**
 * Ungeocoded venues triage.
 *
 * Scraped events publish even when geocoding fails (see lib/scrapers/runner.ts),
 * so they go live without a map pin or neighborhood. This page groups those
 * future events by venue + source so reliable mappings can be added to
 * lib/venues.ts. After adding mappings, run `npm run backfill-geocode` to fill
 * in the existing rows.
 *
 * Location-TBA events (e.g. "TBA (San Francisco)") are excluded — they're
 * intentionally locationless, not a geocoding failure, so there's no venue
 * mapping to add.
 */
export default async function UngeocodedPage() {
  if (!(await getAdminUser())) redirect("/login");

  const events = await prisma.event.findMany({
    where: {
      geocoded: false,
      startDate: { gte: new Date() },
      status: { in: ["PUBLISHED", "PENDING"] },
    },
    select: {
      venueName: true,
      venueAddress: true,
      sourceUrl: true,
      source: { select: { slug: true, name: true } },
    },
    orderBy: { startDate: "asc" },
  });

  // Group by source + venue name so the most impactful venues to map float up.
  interface Group {
    venueName: string | null;
    sourceSlug: string;
    sourceName: string;
    count: number;
    addresses: Set<string>;
    sampleUrl: string;
  }
  const groups = new Map<string, Group>();
  for (const e of events) {
    if (isServiceAreaTBA(e.venueName)) continue;
    const key = `${e.source.slug}::${(e.venueName ?? "").toLowerCase().trim()}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        venueName: e.venueName,
        sourceSlug: e.source.slug,
        sourceName: e.source.name,
        count: 0,
        addresses: new Set(),
        sampleUrl: e.sourceUrl,
      };
      groups.set(key, g);
    }
    g.count++;
    if (e.venueAddress) g.addresses.add(e.venueAddress);
  }
  const sorted = [...groups.values()].sort((a, b) => b.count - a.count);

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h1 className="font-headline font-black text-3xl text-on-surface lowercase">ungeocoded</h1>
        <AdminNav current="ungeocoded" />
        <p className="font-body text-on-surface-variant text-sm">
          {events.length} future event{events.length !== 1 ? "s" : ""} across {sorted.length} venue
          {sorted.length !== 1 ? "s" : ""} published without coordinates · add reliable mappings to{" "}
          <code className="font-mono text-xs bg-surface-container rounded px-1 py-0.5">
            lib/venues.ts
          </code>
          , then run{" "}
          <code className="font-mono text-xs bg-surface-container rounded px-1 py-0.5">
            npm run backfill-geocode
          </code>
        </p>
      </div>

      {sorted.length === 0 ? (
        <p className="font-body text-on-surface-variant">Everything is geocoded. 🎉</p>
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((g) => (
            <div
              key={`${g.sourceSlug}::${g.venueName ?? ""}`}
              className="bg-surface-container rounded-2xl px-5 py-4 flex items-center gap-4"
            >
              <div className="flex-1 min-w-0">
                <h2 className="font-body font-semibold text-sm text-on-surface truncate">
                  {g.venueName ?? "— no venue name —"}
                </h2>
                <p className="font-body text-on-surface-variant text-xs mt-0.5">
                  {g.sourceName}
                  {g.addresses.size > 0 && ` · ${[...g.addresses].join(" / ")}`}
                </p>
                <a
                  href={g.sampleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[10px] text-primary hover:underline mt-0.5 truncate block"
                >
                  {g.sampleUrl}
                </a>
              </div>
              <div className="shrink-0">
                <span className="bg-surface-container-high text-on-surface-variant text-xs font-semibold rounded-full px-2.5 py-1">
                  {g.count} event{g.count !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
