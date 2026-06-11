export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import FilterSidebar from "@/components/layout/FilterSidebar";
import DateGroup from "@/components/events/DateGroup";
import FeaturedCarousel from "@/components/events/FeaturedCarousel";
import TrendingRow from "@/components/events/TrendingRow";
import TimeFilterTabs from "@/components/events/TimeFilterTabs";
import Hero from "@/components/events/Hero";
import EmptyState from "@/components/ui/EmptyState";
import { proxiedImage } from "@/lib/eventImage";
import type { EventSummary } from "@/lib/types";
import { NON_MUSIC_CATEGORIES } from "@/lib/types";
import { addDays } from "date-fns";
import { sfDayKey, sfDayStart, sfDayEnd, matchesTimeOfDay } from "@/lib/sfDate";
import { compareByQualityThenTime } from "@/lib/ranking";
import { Prisma } from "@prisma/client";

interface SearchParams {
  startDate?: string;
  endDate?: string;
  category?: string | string[];
  excludeCategory?: string | string[];
  neighborhood?: string | string[];
  source?: string | string[];
  excludeSource?: string | string[];
  isFree?: string;
  search?: string;
  page?: string;
  hideMusic?: string;
  hideRecurring?: string;
  timeOfDay?: string;
  forYou?: string;
  sort?: string;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Common English words that appear constantly in event titles and are too ambiguous
// to reliably identify an artist, even with word-boundary matching.
const TITLE_MATCH_DENYLIST = new Set([
  "free", "live", "open", "real", "bass", "band", "solo", "wave", "soul",
  "rock", "jazz", "funk", "folk", "doom", "pure", "wild", "blue", "gold",
  "dark", "dawn", "rise", "echo", "fire", "rain", "sage", "west", "east",
  "moon", "star", "nova", "void", "holy", "dead", "loud", "soft", "warm",
]);

function matchesArtists(
  event: { performers: string[]; title: string; category: string | null },
  artistSet: Set<string>
): string | null {
  // Check structured performers first (Bandsintown, RA, Foopee)
  for (const p of event.performers) {
    if (artistSet.has(p.toLowerCase())) return p;
  }
  // For music events with no structured performers, fall back to title word-boundary match.
  // Only on music categories to avoid false positives (e.g. an artist named "live" or "free").
  // Word boundaries prevent "Char" from matching inside "Charles", etc.
  // Denylist skips common English words that appear in event titles regardless of artist names.
  if (event.category?.startsWith("MUSIC_") && event.performers.length === 0) {
    const titleLower = event.title.toLowerCase();
    for (const artist of artistSet) {
      if (
        artist.length >= 4 &&
        !TITLE_MATCH_DENYLIST.has(artist) &&
        new RegExp(`\\b${escapeRegExp(artist)}\\b`).test(titleLower)
      ) {
        return artist;
      }
    }
  }
  return null;
}

async function getSpotifyArtists(sid: string): Promise<Set<string> | null> {
  try {
    const session = await prisma.spotifySession.findUnique({
      where: { id: sid },
      select: { artists: true },
    });
    if (!session) return null;
    return new Set(session.artists);
  } catch {
    return null;
  }
}

async function getWeeklyFeaturedEvents(
  params: Pick<SearchParams, "hideMusic" | "hideRecurring" | "timeOfDay" | "startDate" | "endDate">
): Promise<EventSummary[]> {
  const now = new Date();
  const todayKey = sfDayKey(now);
  const todayStart = sfDayStart(todayKey);
  const weekEnd = addDays(sfDayEnd(todayKey), 6);
  const queryStart = params.startDate ? sfDayStart(params.startDate) : todayStart;
  const queryEnd = params.endDate ? sfDayEnd(params.endDate) : weekEnd;
  const events = await prisma.event.findMany({
    where: {
      status: "PUBLISHED",
      featured: true,
      OR: [
        { endDate: { gte: todayStart } },
        { endDate: null, startDate: { gte: todayStart } },
      ],
      startDate: { gte: queryStart, lte: queryEnd },
      ...(params.hideMusic === "true" && { category: { in: NON_MUSIC_CATEGORIES as any } }),
      ...(params.hideRecurring === "true" && { NOT: { tags: { has: "recurring" } } }),
    },
    orderBy: [{ startDate: "asc" }],
    // Show the full week of featured events. The weekly curation budget is 24
    // (see auto-feature route), so a low LIMIT here would silently drop picks —
    // and with start-time ties + no tiebreaker, *which* ones got dropped varied
    // between requests, making the featured set look random on each visit.
    take: 50,
    select: {
      id: true,
      title: true,
      startDate: true,
      endDate: true,
      venueName: true,
      venueAddress: true,
      neighborhood: true,
      category: true,
      price: true,
      isFree: true,
      imageUrl: true,
      sourceUrl: true,
      tags: true,
      performers: true,
      latitude: true,
      longitude: true,
      featured: true,
      featuredAt: true,
      source: { select: { slug: true, name: true } },
      externalInterest: true,
      _count: { select: { interests: true } },
    },
  });
  const filtered = params.timeOfDay
    ? events.filter((e) => matchesTimeOfDay(e.startDate, params.timeOfDay!))
    : events;
  return filtered.map(({ _count, externalInterest, ...e }) => ({
    ...e,
    startDate: e.startDate.toISOString(),
    endDate: e.endDate?.toISOString() ?? null,
    featuredAt: e.featuredAt?.toISOString() ?? null,
    interestCount: _count.interests + externalInterest,
  })) as EventSummary[];
}

async function getSources() {
  return prisma.source.findMany({
    where: { enabled: true },
    select: { slug: true, name: true },
    orderBy: { name: "asc" },
  });
}

const MAX_DAYS = 10;
const INITIAL_PER_OTHER_DAY = 10;

// "Trending this week" row config. Interest already tiebreaks the per-day feed
// (see lib/ranking.ts); this surfaces the very top of that signal separately.
const TRENDING_WINDOW_DAYS = 7;
// A floor so the row reads as genuine social proof, not "2 people clicked".
const MIN_TRENDING_INTEREST = 5;
// Shown count, and the minimum below which the section is hidden entirely so it
// never renders a lonely one- or two-card row.
const TRENDING_TAKE = 5;
const MIN_TRENDING_EVENTS = 3;

async function getEvents(
  params: SearchParams,
  artistSet: Set<string> | null
): Promise<{
  grouped: Record<string, EventSummary[]>;
  hasMorePerDay: Record<string, boolean>;
  totalPerDay: Record<string, number>;
  total: number;
  trending: EventSummary[];
}> {
  const hasSearch = !!params.search;
  const forYou = params.forYou === "true" && artistSet !== null && artistSet.size > 0;
  const now = new Date();
  const todayKey = sfDayKey(now);
  const todayStart = sfDayStart(todayKey);
  const windowStart = params.startDate
    ? sfDayStart(params.startDate)
    : todayStart;
  const windowEnd = params.endDate
    ? sfDayEnd(params.endDate)
    : hasSearch ? null : sfDayEnd(sfDayKey(addDays(now, 30)));

  const categories = params.category
    ? Array.isArray(params.category)
      ? params.category
      : [params.category]
    : [];
  const excludedCategories = params.excludeCategory
    ? Array.isArray(params.excludeCategory)
      ? params.excludeCategory
      : [params.excludeCategory]
    : [];
  const neighborhoods = params.neighborhood
    ? Array.isArray(params.neighborhood)
      ? params.neighborhood
      : [params.neighborhood]
    : [];
  const sources = params.source
    ? Array.isArray(params.source)
      ? params.source
      : [params.source]
    : [];
  const excludedSources = params.excludeSource
    ? Array.isArray(params.excludeSource)
      ? params.excludeSource
      : [params.excludeSource]
    : [];

  const effectiveCategories =
    params.hideMusic === "true" && categories.length === 0
      ? NON_MUSIC_CATEGORIES
      : params.hideMusic === "true"
      ? categories.filter((c) => !c.startsWith("MUSIC_"))
      : categories;

  const notEndedCondition: Prisma.EventWhereInput | null = windowStart
    ? {
        OR: [
          { endDate: { gte: todayStart } },
          { endDate: null, startDate: { gte: todayStart } },
        ],
      }
    : null;

  const searchCondition: Prisma.EventWhereInput | null = params.search
    ? {
        OR: [
          { title: { contains: params.search, mode: "insensitive" } },
          { description: { contains: params.search, mode: "insensitive" } },
          { venueName: { contains: params.search, mode: "insensitive" } },
        ],
      }
    : null;

  const where: Prisma.EventWhereInput = {
    status: "PUBLISHED",
    AND: [
      ...(notEndedCondition ? [notEndedCondition] : []),
      ...(searchCondition ? [searchCondition] : []),
      ...(params.hideRecurring === "true" ? [{ NOT: { tags: { has: "recurring" } } }] : []),
      ...(excludedCategories.length > 0 ? [{ NOT: { category: { in: excludedCategories as any } } }] : []),
      ...(excludedSources.length > 0 ? [{ NOT: { source: { slug: { in: excludedSources } } } }] : []),
    ],
    ...(windowStart || windowEnd
      ? {
          startDate: {
            ...(windowStart ? { gte: windowStart } : {}),
            ...(windowEnd ? { lte: windowEnd } : {}),
          },
        }
      : {}),
    ...(effectiveCategories.length > 0 && {
      category: { in: effectiveCategories as any },
    }),
    ...(neighborhoods.length > 0 && {
      neighborhood: { in: neighborhoods },
    }),
    ...(sources.length > 0 && {
      source: { slug: { in: sources } },
    }),
    ...(params.isFree === "true" && { isFree: true }),
  };

  // `timeOfDay` and `forYou` are filtered in memory below, so an exact total
  // can only come from the SQL COUNT when neither is active. When one is,
  // we fall back to the post-filter array length.
  const inMemoryFilterActive = !!params.timeOfDay || forYou;

  const [rawEvents, dbCount] = await Promise.all([
    prisma.event.findMany({
      where,
      // Generous cap: the listing only renders the first MAX_DAYS days, which
      // are the earliest rows under `startDate asc`, so 2000 never truncates
      // what's shown. It only bounds the in-memory timeOfDay/forYou pass.
      take: 2000,
      orderBy: [{ startDate: "asc" }],
      select: {
        id: true,
        title: true,
        startDate: true,
        endDate: true,
        venueName: true,
        venueAddress: true,
        neighborhood: true,
        category: true,
        price: true,
        isFree: true,
        imageUrl: true,
        sourceUrl: true,
        tags: true,
        performers: true,
        latitude: true,
        longitude: true,
        featured: true,
        featuredAt: true,
        source: { select: { slug: true, name: true } },
        externalInterest: true,
        _count: { select: { interests: true } },
      },
    }),
    inMemoryFilterActive
      ? Promise.resolve(0)
      : prisma.event.count({ where }),
  ]);

  const timeFiltered = params.timeOfDay
    ? rawEvents.filter((e) => matchesTimeOfDay(e.startDate, params.timeOfDay!))
    : rawEvents;

  // When forYou is active, only keep events matching the user's artists
  const filteredEvents = forYou
    ? timeFiltered.filter((e) => matchesArtists(e, artistSet!) !== null)
    : timeFiltered;

  const allGrouped: Record<string, EventSummary[]> = {};
  for (const { _count, externalInterest, ...event } of filteredEvents) {
    const dk = sfDayKey(event.startDate);
    if (!allGrouped[dk]) allGrouped[dk] = [];
    const spotifyArtist = artistSet ? matchesArtists(event, artistSet) : null;
    allGrouped[dk].push({
      ...event,
      startDate: event.startDate.toISOString(),
      endDate: event.endDate?.toISOString() ?? null,
      featuredAt: event.featuredAt?.toISOString() ?? null,
      interestCount: _count.interests + externalInterest,
      ...(spotifyArtist && { spotifyArtist }),
    } as EventSummary);
  }

  // Default ordering favors higher-signal events (flyer, geocoded venue,
  // non-recurring) within each day, so the visible slice surfaces the best
  // events and recurring filler sinks behind the per-day "show more". Power
  // users can opt back into pure chronological order with ?sort=time. forYou is
  // already a curated subset, so it stays in time order.
  if (params.sort !== "time" && !forYou) {
    for (const dk of Object.keys(allGrouped)) {
      allGrouped[dk].sort(compareByQualityThenTime);
    }
  }

  // "Trending this week": the highest-interest events in the next week, ranked
  // purely by interest count (not the per-day quality order). Computed from the
  // already-fetched set so it costs no extra query. Returned as candidates —
  // the page dedupes against the featured carousel and applies the display cap.
  const weekEnd = sfDayEnd(sfDayKey(addDays(now, TRENDING_WINDOW_DAYS - 1)));
  const trending = Object.values(allGrouped)
    .flat()
    .filter(
      (e) =>
        (e.interestCount ?? 0) >= MIN_TRENDING_INTEREST &&
        new Date(e.startDate) <= weekEnd
    )
    .sort(
      (a, b) =>
        (b.interestCount ?? 0) - (a.interestCount ?? 0) ||
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    );

  const allDays = Object.keys(allGrouped).sort();
  const visibleDays = allDays.slice(0, MAX_DAYS);

  const grouped: Record<string, EventSummary[]> = {};
  const hasMorePerDay: Record<string, boolean> = {};
  const totalPerDay: Record<string, number> = {};
  for (const dk of visibleDays) {
    const all = allGrouped[dk];
    totalPerDay[dk] = all.length;
    if (dk === todayKey) {
      grouped[dk] = all;
      hasMorePerDay[dk] = false;
    } else {
      grouped[dk] = all.slice(0, INITIAL_PER_OTHER_DAY);
      hasMorePerDay[dk] = all.length > INITIAL_PER_OTHER_DAY;
    }
  }

  // Accurate window total: the SQL COUNT (uncapped) when no in-memory filter is
  // active, otherwise the post-filter length. The old code reported the capped
  // 2000-row array length, so "2000 events found" was shown whenever the window
  // held more than 2000 events.
  const total = inMemoryFilterActive ? filteredEvents.length : dbCount;
  return { grouped, hasMorePerDay, totalPerDay, total, trending };
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  // Load Spotify session if present
  const cookieStore = await cookies();
  const sid = cookieStore.get("spotify_sid")?.value;
  const artistSet = sid ? await getSpotifyArtists(sid) : null;
  const spotifyConnected = artistSet !== null;
  const spotifyArtistCount = artistSet?.size ?? 0;

  const [sources, { grouped, hasMorePerDay, totalPerDay, total, trending }, weeklyFeatured] = await Promise.all([
    getSources(),
    getEvents(params, artistSet),
    getWeeklyFeaturedEvents(params),
  ]);

  const days = Object.keys(grouped).sort();
  const hasEvents = days.length > 0;
  const forYouActive = params.forYou === "true" && spotifyConnected;

  const hasNonTopFilters = !!(
    params.category || params.neighborhood || params.source ||
    params.isFree || params.search
  );

  const hasActiveFilters = !!(
    params.startDate || params.endDate || params.category ||
    params.neighborhood || params.source || params.isFree ||
    params.search || params.hideMusic || params.hideRecurring ||
    params.timeOfDay || params.forYou || params.sort
  );

  // Full-bleed hero on the default browse view; compact heading once the
  // visitor is actively filtering/searching (they came to scan, not to land).
  const showHero = !hasNonTopFilters;
  const todayKey = sfDayKey(new Date());
  const heroImages = weeklyFeatured
    .map((e) => proxiedImage(e.imageUrl))
    .filter((src): src is string => !!src)
    .slice(0, 5);

  // Trending row: top community-interest events this week, excluding anything
  // already shown in the featured carousel so the two rows don't duplicate. Only
  // on the default browse view, and only when enough events clear the interest
  // floor to make a credible row.
  const featuredIds = new Set(weeklyFeatured.map((e) => e.id));
  const trendingEvents = trending
    .filter((e) => !featuredIds.has(e.id))
    .slice(0, TRENDING_TAKE);
  const showTrending =
    !hasNonTopFilters && !forYouActive && trendingEvents.length >= MIN_TRENDING_EVENTS;

  return (
    <>
      {showHero && (
        <Hero
          title={forYouActive ? "for you" : "san francisco"}
          subtitle={
            forYouActive
              ? total > 0
                ? `${total} event${total !== 1 ? "s" : ""} matching your Spotify artists`
                : "no matching events — try a wider date range or connect more artists"
              : undefined
          }
          total={total}
          tonightCount={totalPerDay[todayKey] ?? 0}
          images={heroImages}
        />
      )}

    <div className={`max-w-screen-xl mx-auto px-4 sm:px-6 ${showHero ? "pb-6 sm:pb-8" : "py-6 sm:py-8"} flex flex-col lg:flex-row gap-6 lg:gap-8`}>
      {/* Filter sidebar */}
      <div className="w-full lg:w-52 lg:shrink-0">
        <Suspense>
          <FilterSidebar
            sources={sources}
            spotifyConnected={spotifyConnected}
            spotifyArtistCount={spotifyArtistCount}
          />
        </Suspense>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {!showHero && (
          <div className="mb-8">
            <h1 className="font-headline font-black text-4xl sm:text-5xl lg:text-6xl text-on-surface lowercase leading-none">
              san francisco<span className="text-primary">.</span>
            </h1>
            <p className="font-body text-on-surface-variant text-sm mt-2">
              {total > 0
                ? `${total} event${total !== 1 ? "s" : ""} found`
                : "No events found — try adjusting your filters"}
            </p>
          </div>
        )}

        {!hasNonTopFilters && weeklyFeatured.length > 0 && !forYouActive && (
          <div className="mb-6">
            <h2 className="font-headline font-bold text-xl text-on-surface lowercase mb-3">featured events</h2>
            <FeaturedCarousel events={weeklyFeatured} />
          </div>
        )}

        {showTrending && <TrendingRow events={trendingEvents} />}

        <div className="mb-8">
          <Suspense>
            <TimeFilterTabs />
          </Suspense>
        </div>

        {hasEvents ? (
          days.map((dayKey) => (
            <DateGroup
              key={dayKey}
              dayKey={dayKey}
              date={new Date(dayKey + "T12:00:00Z")}
              events={grouped[dayKey]}
              initialHasMore={hasMorePerDay[dayKey] ?? false}
              totalCount={totalPerDay[dayKey]}
            />
          ))
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
    </>
  );
}
