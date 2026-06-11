import { parse, isValid } from "date-fns";
import { computeDedupeHash } from "@/lib/dedupeHash";
import { prisma } from "@/lib/prisma";
import { geocodeEvent } from "@/lib/geocode";
import { resolveVenueId } from "@/lib/venueLink";
import { categorizeEvent } from "@/lib/categorize";
import { sfDayStart, sfDateFromLocal } from "@/lib/sfDate";
import { decodeHtmlEntities } from "@/lib/decodeEntities";
import { isVirtualEvent, isBabyOrSeniorLibraryEvent, isCanceledEvent } from "@/lib/ingestFilters";

const DATE_FORMATS = [
  "yyyy-MM-dd",
  "M/d/yyyy",
  "M/d/yy",
  "EEEE, MMMM d, yyyy",
  "EEEE MMMM d, yyyy",
  "EEEE, MMM d, yyyy",
  "EEEE MMM d, yyyy",
  "EEEE MMMM d yyyy",
  "EEEE MMM d yyyy",
  "EEEE MMMM d",
  "EEEE MMM d",
  "MMMM d, yyyy",
  "MMMM d yyyy",
  "MMM d, yyyy",
  "MMM d yyyy",
  "MMMM d",
  "MMM d",
  "M/d",
];

function startTimeOnly(timeRaw: string): string {
  return timeRaw.split(/\s*[-–]\s*/)[0].trim();
}

// Events ingested here are always near-future (we scrape daily, flyers advertise
// weeks-to-months ahead). A parsed date landing far beyond that window almost
// always means a wrong year — most often an LLM that "filled in" a year the flyer
// never printed (see lib/extract.ts), which we'd otherwise trust because the
// format carried an explicit year. Re-anchor such dates to the nearest sensible
// occurrence instead of trusting the year blindly.
const MAX_FUTURE_DAYS = 310;
const MAX_PAST_DAYS = 60;

function reanchorFarFuture(d: Date): Date {
  const now = Date.now();
  if ((d.getTime() - now) / 86400000 <= MAX_FUTURE_DAYS) return d;
  const out = new Date(d);
  // Step back whole years until the date is within the plausible-future window.
  while ((out.getTime() - now) / 86400000 > MAX_FUTURE_DAYS) {
    out.setFullYear(out.getFullYear() - 1);
  }
  // Don't overshoot into the distant past (e.g. a date that's genuinely ~11
  // months out shouldn't get pulled back a full year).
  if ((out.getTime() - now) / 86400000 < -MAX_PAST_DAYS) {
    out.setFullYear(out.getFullYear() + 1);
  }
  return out;
}

function tryParse(str: string, fmt: string, refYear: number): Date | null {
  const parsed = parse(str.trim(), fmt, new Date(refYear, 0, 1));
  if (!isValid(parsed)) return null;
  // Only bump the year for year-less formats (e.g. "March 27").
  // If the format includes an explicit year (y), trust what was parsed.
  if (!fmt.includes("y")) {
    const diffDays = (parsed.getTime() - Date.now()) / 86400000;
    if (diffDays < -60) parsed.setFullYear(refYear + 1);
  }
  return parsed;
}

export function parseDate(dateRaw: string, timeRaw?: string | null): Date | null {
  const currentYear = new Date().getFullYear();
  const startTime = timeRaw ? startTimeOnly(timeRaw) : null;
  const combined = startTime ? `${dateRaw} ${startTime}` : null;

  const timeSuffixes = ["h:mma", "h:mm a", "ha", "h a", "HH:mm", "h:mm"];

  for (const fmt of DATE_FORMATS) {
    const attempts = [
      ...(combined ? timeSuffixes.map((t) => [combined, `${fmt} ${t}`] as [string, string]) : []),
      [dateRaw, fmt] as [string, string],
    ];
    for (const [str, f] of attempts) {
      const result = tryParse(str, f, currentYear);
      if (result) {
        // date-fns/parse interprets in server-local time (UTC on prod).
        // Re-interpret the parsed components as SF local time so "11:30 AM"
        // from a user means 11:30 AM Pacific, not 11:30 AM UTC.
        if (startTime) {
          // Re-anchor the wall-clock date before converting to a UTC instant so
          // the SF local time is preserved across the year shift.
          const anchored = reanchorFarFuture(result);
          return sfDateFromLocal(
            anchored.getFullYear(),
            anchored.getMonth() + 1,
            anchored.getDate(),
            anchored.getHours(),
            anchored.getMinutes(),
          );
        }
        return reanchorFarFuture(result);
      }
    }
  }

  const native = new Date(dateRaw);
  if (isValid(native)) {
    const diffDays = (native.getTime() - Date.now()) / 86400000;
    if (diffDays < -60) native.setFullYear(currentYear + 1);
    return reanchorFarFuture(native);
  }

  return null;
}

export { computeDedupeHash };

export interface EventFields {
  title: string;
  dateRaw: string;
  timeRaw?: string | null;
  allDay?: boolean;
  venueName?: string | null;
  venueAddress?: string | null;
  price?: string | null;
  isFree?: boolean;
  description?: string | null;
  tags?: string[];
  sourceUrl?: string | null;
  submitterNote?: string | null;
  imageUrl?: string | null;
  categoryOverride?: string | null;
  recurringType?: string | null;
}

export type RejectionReason = "virtual" | "baby-senior" | "canceled";

export type CreateEventResult =
  | { success: true; eventId: string; title: string }
  | { duplicate: true; eventId: string }
  | { parseError: true; message: string }
  | { rejected: true; reason: RejectionReason };

export function rejectionMessage(reason: RejectionReason): string {
  switch (reason) {
    case "virtual":
      return "This looks like a virtual or online-only event. Happening only lists in-person events in San Francisco.";
    case "baby-senior":
      return "This looks like library programming for babies/toddlers or seniors, which Happening doesn't list.";
    case "canceled":
      return "This event appears to be cancelled or postponed, so Happening won't list it.";
  }
}

export async function createEvent(fields: EventFields): Promise<CreateEventResult> {
  const {
    title: titleRaw,
    dateRaw,
    timeRaw,
    allDay: allDayField,
    venueName,
    venueAddress,
    price,
    isFree,
    description: descriptionRaw,
    tags,
    sourceUrl,
    submitterNote,
    imageUrl,
    categoryOverride,
    recurringType,
  } = fields;

  // Apply the same ingestion hygiene the scraper runner does, so every path —
  // scrape, quick submit, URL extract, admin create — gets identical treatment.
  // 1. Decode HTML entity artifacts (e.g. `&#x27;`, `&amp;`) in title/description.
  const title = decodeHtmlEntities(titleRaw);
  const description = descriptionRaw != null ? decodeHtmlEntities(descriptionRaw) : descriptionRaw;

  // 2. Reject virtual/online-only events and off-vibe baby/senior library programming.
  const filterEvent = { title, description: description ?? null, venueName: venueName ?? null, sourceUrl: sourceUrl ?? null, tags: tags ?? [] };
  if (isVirtualEvent(filterEvent)) {
    return { rejected: true, reason: "virtual" };
  }
  if (isBabyOrSeniorLibraryEvent(filterEvent)) {
    return { rejected: true, reason: "baby-senior" };
  }
  if (isCanceledEvent(filterEvent)) {
    return { rejected: true, reason: "canceled" };
  }

  const startDate = parseDate(dateRaw, timeRaw);
  if (!startDate) {
    return {
      parseError: true,
      message: `Could not parse date: "${dateRaw}". Please use a format like "April 5, 2026" or "4/5/2026".`,
    };
  }

  // If no time was provided, store at noon SF time to avoid UTC midnight landing
  // on the previous SF calendar day (e.g. 00:00 UTC = 5 PM PDT the day before).
  const noTimeProvided = !timeRaw?.trim();
  if (noTimeProvided) {
    const y = startDate.getFullYear();
    const m = String(startDate.getMonth() + 1).padStart(2, "0");
    const d = String(startDate.getDate()).padStart(2, "0");
    const sfMidnight = sfDayStart(`${y}-${m}-${d}`);
    startDate.setTime(sfMidnight.getTime() + 12 * 60 * 60 * 1000);
  }
  // allDay is true if caller explicitly sets it, OR if no time was provided (and caller didn't override)
  const allDay = allDayField !== undefined ? allDayField : noTimeProvided;

  const dedupeHash = computeDedupeHash(startDate, title, venueName);

  const existing = await prisma.event.findUnique({ where: { dedupeHash } });
  if (existing) {
    return { duplicate: true, eventId: existing.id };
  }

  const source = await prisma.source.findUnique({ where: { slug: "community" } });
  if (!source) throw new Error("Community source not found");

  const resolvedSourceUrl = sourceUrl || "https://happening.app";

  const geo = await geocodeEvent({
    title,
    venueName: venueName ?? undefined,
    venueAddress: venueAddress ?? undefined,
    sourceUrl: resolvedSourceUrl,
    startDate,
  });

  // Link to the normalized Venue table when the venue is known (community
  // submissions never carry SFPL branch labels, so no source slug is passed).
  const venueId = await resolveVenueId(venueName);

  const category = categoryOverride
    ? (categoryOverride as import("@prisma/client").EventCategory)
    : await categorizeEvent({
        title,
        description: description ?? undefined,
        venueName: venueName ?? undefined,
        tags: tags ?? [],
        sourceUrl: resolvedSourceUrl,
        startDate,
      });

  const event = await prisma.event.create({
    data: {
      dedupeHash,
      title: title.trim(),
      description: description ?? null,
      startDate,
      allDay,
      venueName: venueName || null,
      venueAddress: venueAddress || null,
      venueId,
      neighborhood: geo.neighborhood,
      latitude: geo.latitude,
      longitude: geo.longitude,
      price: price || null,
      isFree: Boolean(isFree),
      imageUrl: imageUrl || null,
      sourceUrl: resolvedSourceUrl,
      tags: Array.isArray(tags) ? tags : [],
      category,
      geocoded: geo.latitude != null,
      categorized: true,
      status: "PENDING",
      submitterNote: submitterNote || null,
      sourceId: source.id,
      recurringType: recurringType ? (recurringType as import("@prisma/client").RecurringType) : null,
    },
  });

  return { success: true, eventId: event.id, title: event.title };
}
