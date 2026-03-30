export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { CATEGORY_LABELS } from "@/lib/types";
import { format } from "date-fns";
import Link from "next/link";
import AdminNav from "../_components/AdminNav";
import FeaturedToggle from "../submissions/FeaturedToggle";
import { SourceCategory } from "@prisma/client";

interface Props {
  searchParams: Promise<{ secret?: string; sourceId?: string }>;
}

// Sources we consider "underground" / most likely to surface your criteria —
// shown first regardless of SourceCategory enum.
const PRIORITY_SLUGS = [
  "medicine-for-nightmares",
  "citylights",
  "omnivorebooks",
  "sfjazz",
  "noe-valley-town-square",
  "residentadvisor",
  "19hz",
  "foopee",
  "badslava",
  "decentered",
  "funcheap",
  "kqed",
  "reddit",
];

const CATEGORY_ORDER: SourceCategory[] = [
  "VENUE",
  "COMMUNITY",
  "INSTITUTIONAL",
  "AGGREGATOR",
];

function sourceSort(
  a: { slug: string; category: SourceCategory },
  b: { slug: string; category: SourceCategory }
) {
  const ai = PRIORITY_SLUGS.indexOf(a.slug);
  const bi = PRIORITY_SLUGS.indexOf(b.slug);
  // Both in priority list → use that order
  if (ai !== -1 && bi !== -1) return ai - bi;
  // One in priority list → it goes first
  if (ai !== -1) return -1;
  if (bi !== -1) return 1;
  // Neither → fall back to category order
  const ac = CATEGORY_ORDER.indexOf(a.category);
  const bc = CATEGORY_ORDER.indexOf(b.category);
  return ac - bc;
}

export default async function CurationPage({ searchParams }: Props) {
  const { secret, sourceId } = await searchParams;

  if (!secret || secret !== process.env.SCRAPE_SECRET) {
    return (
      <div className="max-w-screen-md mx-auto px-6 py-16 text-center">
        <p className="font-body text-on-surface-variant">Access denied.</p>
      </div>
    );
  }

  const now = new Date();

  const [unfeaturedEvents, featuredCount] = await Promise.all([
    prisma.event.findMany({
      where: {
        status: "PUBLISHED",
        featured: false,
        startDate: { gte: now },
        ...(sourceId ? { sourceId } : {}),
      },
      orderBy: { startDate: "asc" },
      select: {
        id: true,
        title: true,
        description: true,
        startDate: true,
        venueName: true,
        neighborhood: true,
        category: true,
        tags: true,
        isFree: true,
        price: true,
        imageUrl: true,
        source: {
          select: { id: true, slug: true, name: true, category: true },
        },
      },
    }),
    prisma.event.count({
      where: { status: "PUBLISHED", featured: true, startDate: { gte: now } },
    }),
  ]);

  // Group by source
  const bySource = new Map<
    string,
    {
      source: { id: string; slug: string; name: string; category: SourceCategory };
      events: typeof unfeaturedEvents;
    }
  >();

  for (const event of unfeaturedEvents) {
    const key = event.source.id;
    if (!bySource.has(key)) {
      bySource.set(key, { source: event.source as any, events: [] });
    }
    bySource.get(key)!.events.push(event);
  }

  // Sort source groups
  const sortedGroups = Array.from(bySource.values()).sort((a, b) =>
    sourceSort(a.source, b.source)
  );

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h1 className="font-headline font-black text-3xl text-on-surface lowercase">
          curation
        </h1>
        <AdminNav secret={secret} current="curation" />
        <p className="font-body text-on-surface-variant text-sm">
          {unfeaturedEvents.length} unfeatured upcoming event
          {unfeaturedEvents.length !== 1 ? "s" : ""} · {featuredCount} currently
          featured
        </p>
      </div>

      {sortedGroups.length === 0 ? (
        <p className="font-body text-on-surface-variant">
          No unfeatured upcoming events.
        </p>
      ) : (
        <div className="flex flex-col gap-10">
          {sortedGroups.map(({ source, events }) => (
            <div key={source.id}>
              {/* Source header */}
              <div className="flex items-center gap-3 mb-3 pb-2 border-b border-outline-variant">
                <span className="font-headline font-bold text-base text-on-surface lowercase">
                  {source.name}
                </span>
                <span className="font-body text-[0.6rem] font-semibold uppercase tracking-widest text-on-surface-variant px-1.5 py-0.5 bg-surface-container rounded-DEFAULT">
                  {source.category.toLowerCase()}
                </span>
                <span className="font-body text-xs text-on-surface-variant ml-auto">
                  {events.length} event{events.length !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Event cards */}
              <div className="flex flex-col gap-2">
                {events.map((event) => {
                  const desc = event.description
                    ? event.description.length > 140
                      ? event.description.slice(0, 140).trimEnd() + "…"
                      : event.description
                    : null;
                  const catLabel = event.category
                    ? CATEGORY_LABELS[event.category]
                    : null;

                  return (
                    <div
                      key={event.id}
                      className="bg-surface-container rounded-2xl px-5 py-4 flex gap-4"
                    >
                      {/* Image thumbnail */}
                      {event.imageUrl && (
                        <div
                          className="w-14 h-14 rounded-lg shrink-0 bg-cover bg-center bg-surface-container-high"
                          style={{ backgroundImage: `url(${event.imageUrl})` }}
                        />
                      )}

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Link
                              href={`/events/${event.id}?secret=${secret}`}
                              target="_blank"
                              className="font-body font-semibold text-sm text-on-surface hover:text-primary transition-colors line-clamp-1"
                            >
                              {event.title}
                            </Link>
                            <p className="font-body text-xs text-on-surface-variant mt-0.5">
                              {format(event.startDate, "EEE, MMM d · h:mm a")}
                              {event.venueName && ` · ${event.venueName}`}
                              {event.neighborhood && ` · ${event.neighborhood}`}
                            </p>
                          </div>
                          <FeaturedToggle
                            id={event.id}
                            featured={false}
                            secret={secret}
                          />
                        </div>

                        {desc && (
                          <p className="font-body text-xs text-on-surface-variant mt-1.5 leading-relaxed">
                            {desc}
                          </p>
                        )}

                        {/* Chips row */}
                        <div className="flex flex-wrap gap-1 mt-2">
                          {catLabel && (
                            <span className="chip text-[0.6rem]">{catLabel}</span>
                          )}
                          {(event.isFree || event.price) && (
                            <span className="chip text-[0.6rem]">
                              {event.isFree ? "Free" : event.price}
                            </span>
                          )}
                          {event.tags.slice(0, 4).map((tag) => (
                            <span key={tag} className="chip text-[0.6rem]">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
