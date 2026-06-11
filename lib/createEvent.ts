import { parse, isValid } from "date-fns";
import { computeDedupeHash } from "@/lib/dedupeHash";
import { prisma } from "@/lib/prisma";
import { geocodeEvent } from "@/lib/geocode";
import { categorizeEvent } from "@/lib/categorize";
import { sfDayStart, sfDateFromLocal } from "@/lib/sfDate";
import { decodeHtmlEntities } from "@/lib/decodeEntities";
import { isVirtualEvent, isBabyOrSeniorLibraryEvent } from "@/lib/eventFilters";

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
          return sfDateFromLocal(
            result.getFullYear(),
            result.getMonth() + 1,
            result.getDate(),
            result.getHours(),
            result.getMinutes(),
          );
        }
        return result;
      }
    }
  }

  const native = new Date(dateRaw);
  if (isValid(native)) {
    const diffDays = (native.getTime() - Date.now()) / 86400000;
    if (diffDays < -60) native.setFullYear(currentYear + 1);
    return native;
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

export type CreateEventResult =
  | { success: true; eventId: string; title: string }
  | { duplicate: true; eventId: string }
  | { parseError: true; message: string }
  | { rejected: true; reason: string };

export async function createEvent(fields: EventFields): Promise<CreateEventResult> {
  const {
    title: rawTitle,
    dateRaw,
    timeRaw,
    allDay: allDayField,
    venueName,
    venueAddress,
    price,
    isFree,
    description: rawDescription,
    tags,
    sourceUrl,
    submitterNote,
    imageUrl,
    categoryOverride,
    recurringType,
  } = fields;

  // Decode HTML entities (e.g. &amp;, &#39;) so encoded artifacts never reach
  // storage, the dedupe hash, or downstream filters. Applied here so every
  // creation path — quick submit, full form, URL extract, admin create — gets
  // the same hygiene the scraper runner already does. (See issue #87.)
  const title = decodeHtmlEntities(rawTitle);
  const description = rawDescription != null ? decodeHtmlEntities(rawDescription) : rawDescription;

  // Same ingestion-quality gates the scraper runner applies: drop online-only
  // events and babies/seniors library programming, which are off-vibe for the app.
  if (isVirtualEvent({ title, description, venueName })) {
    return { rejected: true, reason: "This looks like a virtual / online-only event, which we don't list." };
  }
  if (isBabyOrSeniorLibraryEvent({ title, venueName, sourceUrl, tags })) {
    return { rejected: true, reason: "This looks like a babies/seniors library program, which we don't list." };
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
