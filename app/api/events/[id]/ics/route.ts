import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function icalDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icalEscape(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const event = await prisma.event.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      startDate: true,
      endDate: true,
      allDay: true,
      venueName: true,
      venueAddress: true,
      description: true,
      sourceUrl: true,
    },
  });

  if (!event) {
    return new NextResponse("Not found", { status: 404 });
  }

  const dtStamp = icalDate(new Date());
  const location = event.venueAddress ?? event.venueName ?? "";
  const description = event.description
    ? `${icalEscape(event.description)}\\n\\n${event.sourceUrl}`
    : event.sourceUrl;

  // For all-day events, use DATE format (YYYYMMDD) per RFC 5545
  function icalDateOnly(date: Date): string {
    return date.toISOString().slice(0, 10).replace(/-/g, "");
  }

  const dtStartLine = event.allDay
    ? `DTSTART;VALUE=DATE:${icalDateOnly(event.startDate)}`
    : `DTSTART:${icalDate(event.startDate)}`;

  const endDateResolved = event.allDay
    ? // For all-day events, DTEND is exclusive — use the next day if no endDate
      event.endDate ?? new Date(event.startDate.getTime() + 24 * 60 * 60 * 1000)
    : // For timed events, default end: startDate + 2 hours if no endDate
      event.endDate ?? new Date(event.startDate.getTime() + 2 * 60 * 60 * 1000);

  const dtEndLine = event.allDay
    ? `DTEND;VALUE=DATE:${icalDateOnly(endDateResolved)}`
    : `DTEND:${icalDate(endDateResolved)}`;

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//happening//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.id}@happening`,
    `DTSTAMP:${dtStamp}`,
    dtStartLine,
    dtEndLine,
    `SUMMARY:${icalEscape(event.title)}`,
    `DESCRIPTION:${description}`,
    ...(location ? [`LOCATION:${icalEscape(location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const filename = event.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.ics"`,
    },
  });
}
