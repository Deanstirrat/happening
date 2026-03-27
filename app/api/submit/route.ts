import { NextRequest, NextResponse } from "next/server";
import { createEvent, parseDate } from "@/lib/createEvent";

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

    // Validate date before calling createEvent so we can return a good error message
    const startDate = parseDate(dateRaw, timeRaw);
    if (!startDate) {
      return NextResponse.json(
        {
          error: `Could not parse date: "${dateRaw}". Please use a format like "April 5, 2026" or "4/5/2026".`,
        },
        { status: 400 }
      );
    }

    const result = await createEvent({
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
    });

    if ("parseError" in result) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    if ("duplicate" in result) {
      return NextResponse.json({
        duplicate: true,
        eventId: result.eventId,
        message: "This event is already in the system.",
      });
    }

    return NextResponse.json({ success: true, eventId: result.eventId });
  } catch (err: any) {
    console.error("[submit]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
