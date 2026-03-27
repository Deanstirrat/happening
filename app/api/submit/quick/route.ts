import { NextRequest, NextResponse } from "next/server";
import { extractEventFromImage } from "@/lib/extract";
import { createEvent } from "@/lib/createEvent";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const imageFile = formData.get("image") as File | null;
    const note = (formData.get("note") as string | null) ?? undefined;

    if (!imageFile) {
      return NextResponse.json({ error: "An image is required" }, { status: 400 });
    }

    const buffer = await imageFile.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const mediaType = imageFile.type || "image/jpeg";

    const extracted = await extractEventFromImage(base64, mediaType, note);

    if (!extracted.title || !extracted.dateRaw) {
      return NextResponse.json(
        {
          error:
            "Couldn't read event details from this image. Try the full form to enter details manually.",
        },
        { status: 422 }
      );
    }

    const result = await createEvent({
      title: extracted.title,
      dateRaw: extracted.dateRaw,
      timeRaw: extracted.timeRaw,
      venueName: extracted.venueName,
      venueAddress: extracted.venueAddress,
      price: extracted.price,
      isFree: extracted.isFree,
      description: extracted.description,
      tags: extracted.tags ?? [],
      sourceUrl: null,
      submitterNote: note || null,
    });

    if ("parseError" in result) {
      return NextResponse.json({ error: result.message }, { status: 422 });
    }

    if ("duplicate" in result) {
      return NextResponse.json({
        duplicate: true,
        eventId: result.eventId,
        message: "This event is already in the system.",
      });
    }

    return NextResponse.json({ success: true, eventId: result.eventId, title: result.title });
  } catch (err: any) {
    console.error("[submit/quick]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
