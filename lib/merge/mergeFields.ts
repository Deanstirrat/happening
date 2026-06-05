/**
 * Pure field-level merge: given a cluster of duplicate events, pick the survivor
 * (the row whose id/URL we keep) and compute the best value for every field by
 * combining the highest-quality data from each member.
 *
 * No I/O here — the orchestrator (scripts/merge-dups.ts) handles DB reads/writes
 * and the LLM title/description synthesis. This module owns the deterministic
 * "which value is best" rules and is straightforward to unit-test.
 */
import type { EventCategory, RecurringType } from "@prisma/client";

export interface MergeableEvent {
  id: string;
  title: string;
  description: string | null;
  startDate: Date;
  endDate: Date | null;
  allDay: boolean;
  venueName: string | null;
  venueAddress: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  category: EventCategory | null;
  price: string | null;
  isFree: boolean;
  imageUrl: string | null;
  sourceUrl: string;
  tags: string[];
  performers: string[];
  featured: boolean;
  featuredAt: Date | null;
  recurringType: RecurringType | null;
  scrapedAt: Date;
  /** Number of EventInteraction rows — used to keep the most-linked row as survivor. */
  interactionCount: number;
}

/** Fields the deterministic merge can write to the survivor. */
export type MergedFields = {
  description: string | null;
  endDate: Date | null;
  venueName: string | null;
  venueAddress: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  category: EventCategory | null;
  price: string | null;
  isFree: boolean;
  imageUrl: string | null;
  sourceUrl: string;
  tags: string[];
  performers: string[];
  featured: boolean;
  featuredAt: Date | null;
  recurringType: RecurringType | null;
  /** Deterministic best title, used as a fallback if LLM synthesis is unavailable. */
  fallbackTitle: string;
};

export const LOW_QUALITY_DOMAINS = ["foopee.com", "19hz.info"];

function isLowQualityUrl(url: string): boolean {
  return LOW_QUALITY_DOMAINS.some((d) => url.includes(d));
}

function norm(s: string | null): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** A title that's just the venue name repeated is a placeholder, not a real title. */
function isVenueAsTitle(e: MergeableEvent): boolean {
  return e.venueName != null && norm(e.title) === norm(e.venueName);
}

/** A start time of exactly local-midnight usually means "time unknown", not a real time. */
function hasSpecificTime(d: Date): boolean {
  return !(d.getUTCHours() === 0 && d.getUTCMinutes() === 0);
}

/**
 * Pick the survivor: the row we keep (its id and /events/<id> URL stay valid;
 * losers redirect to it). Prefer the most-linked, richest row so we retain the
 * most inbound links and analytics. Order: has image > high-quality source >
 * most interactions > earliest scraped (stable, oldest URL) > lowest id.
 */
export function pickSurvivor<T extends MergeableEvent>(events: T[]): T {
  return [...events].sort((a, b) => {
    const aImg = a.imageUrl ? 1 : 0;
    const bImg = b.imageUrl ? 1 : 0;
    if (aImg !== bImg) return bImg - aImg;

    const aHQ = isLowQualityUrl(a.sourceUrl) ? 0 : 1;
    const bHQ = isLowQualityUrl(b.sourceUrl) ? 0 : 1;
    if (aHQ !== bHQ) return bHQ - aHQ;

    if (a.interactionCount !== b.interactionCount)
      return b.interactionCount - a.interactionCount;

    if (a.scrapedAt.getTime() !== b.scrapedAt.getTime())
      return a.scrapedAt.getTime() - b.scrapedAt.getTime();

    return a.id < b.id ? -1 : 1;
  })[0];
}

/**
 * Compute best-of-each field values for the survivor, drawing from every member
 * of the cluster. `survivor` is the row whose id we keep; its values win ties.
 */
export function mergeFields(events: MergeableEvent[], survivor: MergeableEvent): MergedFields {
  // Order members so the survivor's values are preferred on ties, then richer rows.
  const ordered = [
    survivor,
    ...events.filter((e) => e.id !== survivor.id),
  ];

  const firstTruthy = <V>(pick: (e: MergeableEvent) => V | null | undefined): V | null => {
    for (const e of ordered) {
      const v = pick(e);
      if (v !== null && v !== undefined && v !== "") return v as V;
    }
    return null;
  };

  // Description: prefer the longest non-empty (more detail), survivor breaks ties.
  const description =
    ordered
      .map((e) => e.description?.trim())
      .filter((d): d is string => !!d)
      .sort((a, b) => b.length - a.length)[0] ?? null;

  // Venue: prefer a non-generic, specific name; pair it with an address if any member has one.
  const venueName = firstTruthy((e) => (isVenueAsTitle(e) ? null : e.venueName)) ?? survivor.venueName;
  const venueAddress = firstTruthy((e) => e.venueAddress);

  // Geo: prefer any geocoded coordinates + neighborhood.
  const latitude = firstTruthy((e) => e.latitude);
  const longitude = firstTruthy((e) => e.longitude);
  const neighborhood = firstTruthy((e) => e.neighborhood);

  // Category: prefer a specific (non-OTHER) category.
  const category =
    firstTruthy((e) => (e.category && e.category !== "OTHER" ? e.category : null)) ??
    survivor.category;

  // Pricing: an explicit price string wins; isFree only if no member lists a price.
  const price = firstTruthy((e) => e.price);
  const isFree = price ? false : ordered.some((e) => e.isFree);

  const imageUrl = firstTruthy((e) => e.imageUrl);

  // Source URL: prefer a high-quality (non-list-page) source.
  const sourceUrl =
    ordered.find((e) => !isLowQualityUrl(e.sourceUrl))?.sourceUrl ?? survivor.sourceUrl;

  // End time: prefer a real specific end time.
  const endDate = firstTruthy((e) => (e.endDate && hasSpecificTime(e.endDate) ? e.endDate : null)) ??
    firstTruthy((e) => e.endDate);

  // Tags / performers: union across the cluster (case-insensitive dedupe).
  const union = (lists: string[][]): string[] => {
    const seen = new Map<string, string>();
    for (const list of lists) {
      for (const item of list) {
        const k = item.trim().toLowerCase();
        if (k && !seen.has(k)) seen.set(k, item.trim());
      }
    }
    return [...seen.values()];
  };
  const tags = union(ordered.map((e) => e.tags));
  const performers = union(ordered.map((e) => e.performers));

  // Curation: never lose a featured flag; keep the earliest featuredAt.
  const featured = ordered.some((e) => e.featured);
  const featuredAt = ordered
    .map((e) => e.featuredAt)
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  const recurringType = firstTruthy((e) => e.recurringType);

  // Fallback title: prefer a real (non-placeholder) title; among those the
  // survivor wins, else the longest. LLM synthesis overrides this when available.
  const realTitles = ordered.filter((e) => !isVenueAsTitle(e));
  const fallbackTitle =
    (realTitles.find((e) => e.id === survivor.id) ?? realTitles[0] ?? survivor).title;

  return {
    description,
    endDate,
    venueName,
    venueAddress,
    neighborhood,
    latitude,
    longitude,
    category,
    price,
    isFree,
    imageUrl,
    sourceUrl,
    tags,
    performers,
    featured,
    featuredAt,
    recurringType,
    fallbackTitle,
  };
}
