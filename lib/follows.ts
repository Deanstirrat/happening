import { prisma } from "@/lib/prisma";
import { matchesArtists } from "@/lib/artistMatch";
import type { EventSummary, EventCategory } from "@/lib/types";
import { MUSIC_CATEGORIES } from "@/lib/types";
import { Prisma } from "@prisma/client";

const MUSIC_CATEGORY_VALUES = [...MUSIC_CATEGORIES] as EventCategory[];

// How far ahead the "following" feed looks. Long enough to be a useful standing
// view, bounded so the artist pass (which filters candidates in memory) stays cheap.
const WINDOW_DAYS = 30;
const MAX_EVENTS = 100;

export interface FollowSets {
  venueIds: string[];
  categories: EventCategory[];
  /** Lowercased artist names, matched via lib/artistMatch. */
  artists: Set<string>;
}

/** Group a user's follow rows by target type into ready-to-query sets. */
export async function getFollowSets(userId: string): Promise<FollowSets> {
  const follows = await prisma.follow.findMany({
    where: { userId },
    select: { targetType: true, targetId: true },
  });

  const venueIds: string[] = [];
  const categories: EventCategory[] = [];
  const artists = new Set<string>();

  for (const f of follows) {
    if (f.targetType === "VENUE") venueIds.push(f.targetId);
    else if (f.targetType === "CATEGORY") categories.push(f.targetId as EventCategory);
    else if (f.targetType === "ARTIST") artists.add(f.targetId);
  }

  return { venueIds, categories, artists };
}

export function hasAnyFollows(sets: FollowSets): boolean {
  return sets.venueIds.length > 0 || sets.categories.length > 0 || sets.artists.size > 0;
}

const eventSelect = {
  id: true,
  title: true,
  startDate: true,
  endDate: true,
  allDay: true,
  venueId: true,
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
} satisfies Prisma.EventSelect;

type RawEvent = Prisma.EventGetPayload<{ select: typeof eventSelect }>;

function toSummary(e: RawEvent, spotifyArtist?: string): EventSummary {
  const { _count, externalInterest, venueId, ...rest } = e;
  void venueId;
  return {
    ...rest,
    startDate: e.startDate.toISOString(),
    endDate: e.endDate?.toISOString() ?? null,
    featuredAt: e.featuredAt?.toISOString() ?? null,
    interestCount: _count.interests + externalInterest,
    ...(spotifyArtist ? { spotifyArtist } : {}),
  };
}

/**
 * Upcoming events matching anything a user follows (venue, category, or artist),
 * sorted soonest-first. Shared by the /following page and (later) the weekly
 * digest (#97). Returns [] when the user follows nothing.
 *
 * Venue/category follows resolve to a direct DB query. Artist follows are matched
 * in memory with lib/artistMatch (same rules as the Spotify "for you" feed), so a
 * candidate window is pulled and filtered rather than queried by performer.
 */
export async function getFollowedEvents(userId: string): Promise<EventSummary[]> {
  const sets = await getFollowSets(userId);
  if (!hasAnyFollows(sets)) return [];

  const now = new Date();
  const windowEnd = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Upcoming = not yet ended (multi-day events stay until their end), within window.
  const upcoming: Prisma.EventWhereInput = {
    status: "PUBLISHED",
    startDate: { lte: windowEnd },
    OR: [{ endDate: { gte: now } }, { endDate: null, startDate: { gte: now } }],
  };

  const byId = new Map<string, EventSummary>();

  // Venue + category follows: one direct query.
  const directOr: Prisma.EventWhereInput[] = [];
  if (sets.venueIds.length) directOr.push({ venueId: { in: sets.venueIds } });
  if (sets.categories.length) directOr.push({ category: { in: sets.categories } });
  if (directOr.length) {
    const rows = await prisma.event.findMany({
      where: { AND: [upcoming, { OR: directOr }] },
      orderBy: { startDate: "asc" },
      take: MAX_EVENTS,
      select: eventSelect,
    });
    for (const r of rows) byId.set(r.id, toSummary(r));
  }

  // Artist follows: pull a music/performer candidate window and match in memory.
  if (sets.artists.size) {
    const candidates = await prisma.event.findMany({
      where: {
        AND: [
          upcoming,
          { OR: [{ category: { in: MUSIC_CATEGORY_VALUES } }, { NOT: { performers: { isEmpty: true } } }] },
        ],
      },
      orderBy: { startDate: "asc" },
      take: 500,
      select: eventSelect,
    });
    for (const c of candidates) {
      const hit = matchesArtists(c, sets.artists);
      if (hit && !byId.has(c.id)) byId.set(c.id, toSummary(c, hit));
    }
  }

  return [...byId.values()]
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, MAX_EVENTS);
}
