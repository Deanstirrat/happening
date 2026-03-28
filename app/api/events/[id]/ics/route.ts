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
      venueName: true,
      venueAddress: true,
      description: true,
      sourceUrl: true,
    },
  });

  if (!event) {
    return new NextResponse("Not found", { status: 404 });
  }

  const dtStart = icalDate(event.startDate);
  // Default end: startDate + 2 hours if no endDate
  const endDate = event.endDate ?? new Date(event.startDate.getTime() + 2 * 60 * 60 * 1000);
  const dtEnd = icalDate(endDate);
  const dtStamp = icalDate(new Date());
  const location = event.venueAddress ?? event.venueName ?? "";
  const description = event.description
    ? `${icalEscape(event.description)}\\n\\n${event.sourceUrl}`
    : event.sourceUrl;

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//happening//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.id}@happening`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
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
