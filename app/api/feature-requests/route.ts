import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const { name, email, eventName, eventDate, eventUrl, message, eventId, suggestedEdits } =
    await req.json();

  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    return NextResponse.json(
      { error: "name, email, and message are required" },
      { status: 400 }
    );
  }

  // When linking to an existing event, eventName is optional (we derive it)
  if (!eventId && !eventName?.trim()) {
    return NextResponse.json(
      { error: "eventName is required when not linking to an existing event" },
      { status: 400 }
    );
  }

  let resolvedEventName = eventName?.trim() || "";
  if (eventId) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { title: true },
    });
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    resolvedEventName = resolvedEventName || event.title;
  }

  await prisma.featuredRequest.create({
    data: {
      name: name.trim(),
      email: email.trim(),
      eventName: resolvedEventName,
      eventDate: eventDate?.trim() || null,
      eventUrl: eventUrl?.trim() || null,
      message: message.trim(),
      eventId: eventId || null,
      suggestedEdits: suggestedEdits || null,
    },
  });

  return NextResponse.json({ success: true });
}
