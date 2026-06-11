import { NextRequest, NextResponse } from "next/server";
import { createEvent, parseDate } from "@/lib/createEvent";
import { prisma } from "@/lib/prisma";

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
      imageUrl,
      category,
      unknownSourceUrl,
      recurringType,
      fromFeature,
    } = body;

    const effectiveNote = fromFeature
      ? `[FEATURE REQUEST]${submitterNote ? ` ${submitterNote}` : ""}`
      : submitterNote;

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
      submitterNote: effectiveNote,
      imageUrl: imageUrl || null,
      categoryOverride: category || null,
      recurringType: recurringType || null,
    });

    if ("parseError" in result) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    if ("rejected" in result) {
      return NextResponse.json({ error: result.reason }, { status: 422 });
    }

    if ("duplicate" in result) {
      await prisma.submission.create({
        data: {
          title: title.trim(),
          startDate,
          outcome: "DUPLICATE",
          eventId: result.eventId,
          submitterNote: effectiveNote || null,
          unknownSourceUrl: unknownSourceUrl || null,
        },
      });
      return NextResponse.json({
        duplicate: true,
        eventId: result.eventId,
        message: "This event is already in the system.",
      });
    }

    await prisma.submission.create({
      data: {
        title: title.trim(),
        startDate,
        outcome: "CREATED",
        eventId: result.eventId,
        submitterNote: submitterNote || null,
        unknownSourceUrl: unknownSourceUrl || null,
      },
    });

    return NextResponse.json({ success: true, eventId: result.eventId });
  } catch (err: any) {
    console.error("[submit]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
