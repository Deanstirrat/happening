import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { parse, isValid } from "date-fns";
import { prisma } from "@/lib/prisma";
import { geocodeEvent } from "@/lib/geocode";
import { categorizeEvent } from "@/lib/categorize";

// Mirrors BaseScraper.computeDedupeHash — date + normalized title
function computeDedupeHash(startDate: Date, title: string): string {
  const dateStr = startDate.toISOString().slice(0, 10);
  const normalizedTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(`${dateStr}::${normalizedTitle}`).digest("hex");
}

// Date formats in priority order — more specific first
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

// Extract just the start time from "9pm - 4am" or "9:00 PM – 2:00 AM"
function startTimeOnly(timeRaw: string): string {
  return timeRaw.split(/\s*[-–]\s*/)[0].trim();
}

function tryParse(str: string, fmt: string, refYear: number): Date | null {
  const parsed = parse(str.trim(), fmt, new Date(refYear, 0, 1));
  if (!isValid(parsed)) return null;
  const diffDays = (parsed.getTime() - Date.now()) / 86400000;
  if (diffDays < -60) parsed.setFullYear(refYear + 1);
  return parsed;
}

function parseDate(dateRaw: string, timeRaw?: string | null): Date | null {
  const currentYear = new Date().getFullYear();
  const startTime = timeRaw ? startTimeOnly(timeRaw) : null;
  const combined = startTime ? `${dateRaw} ${startTime}` : null;

  const timeSuffixes = ["h:mma", "h:mm a", "ha", "h a"];

  for (const fmt of DATE_FORMATS) {
    // Try combined date+time first, then date alone
    const attempts = [
      ...(combined ? timeSuffixes.map((t) => [combined, `${fmt} ${t}`] as [string, string]) : []),
      [dateRaw, fmt] as [string, string],
    ];
    for (const [str, f] of attempts) {
      const result = tryParse(str, f, currentYear);
      if (result) return result;
    }
  }

  // Last resort: native Date parsing on the raw string
  const native = new Date(dateRaw);
  if (isValid(native)) {
    const diffDays = (native.getTime() - Date.now()) / 86400000;
    if (diffDays < -60) native.setFullYear(currentYear + 1);
    return native;
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      title,
      dateRaw,
      timeRaw,
      venueName,
      venueAddress,
      price,
      isFree,
      description,
      tags,
      sourceUrl,
      submitterNote,
    } = body;

    if (!title?.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    if (!dateRaw?.trim()) {
      return NextResponse.json({ error: "Date is required" }, { status: 400 });
    }

    const startDate = parseDate(dateRaw, timeRaw);
    if (!startDate) {
      return NextResponse.json(
        {
          error: `Could not parse date: "${dateRaw}". Please use a format like "April 5, 2026" or "4/5/2026".`,
        },
        { status: 400 }
      );
    }

    const dedupeHash = computeDedupeHash(startDate, title);

    // Check for existing event
    const existing = await prisma.event.findUnique({ where: { dedupeHash } });
    if (existing) {
      return NextResponse.json({
        duplicate: true,
        eventId: existing.id,
        message: "This event is already in the system.",
      });
    }

    // Get community source
    const source = await prisma.source.findUnique({ where: { slug: "community" } });
    if (!source) {
      return NextResponse.json({ error: "Community source not found" }, { status: 500 });
    }

    // Geocode
    const geo = await geocodeEvent({
      title,
      venueName,
      venueAddress,
      sourceUrl: sourceUrl || "https://happening.app",
      startDate,
    });

    // Categorize
    const category = await categorizeEvent({
      title,
      description,
      venueName,
      tags,
      sourceUrl: sourceUrl || "https://happening.app",
      startDate,
    });

    const event = await prisma.event.create({
      data: {
        dedupeHash,
        title: title.trim(),
        description: description ?? null,
        startDate,
        venueName: venueName || null,
        venueAddress: venueAddress || null,
        neighborhood: geo.neighborhood,
        latitude: geo.latitude,
        longitude: geo.longitude,
        price: price || null,
        isFree: Boolean(isFree),
        sourceUrl: sourceUrl || "https://happening.app",
        tags: Array.isArray(tags) ? tags : [],
        category,
        geocoded: geo.latitude != null,
        categorized: true,
        status: "PENDING",
        submitterNote: submitterNote || null,
        sourceId: source.id,
      },
    });

    return NextResponse.json({ success: true, eventId: event.id });
  } catch (err: any) {
    console.error("[submit]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
