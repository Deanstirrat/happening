import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Anonymous "I'm interested" vote toggle for an event.
 *
 * Works on ANY published event (not just featured) so the signal can later
 * inform which events get featured. Idempotent: the client sends its desired
 * state, and the server returns the authoritative count.
 *
 * Body: { sessionId: string, interested: boolean }
 * Returns: { ok, interested, count }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const sessionId: unknown = body?.sessionId;
    const interested: unknown = body?.interested;

    if (typeof sessionId !== "string" || !sessionId || typeof interested !== "boolean") {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const event = await prisma.event.findUnique({
      where: { id },
      select: { id: true, status: true, externalInterest: true },
    });
    if (!event || event.status !== "PUBLISHED") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (interested) {
      // Add the vote (no-op if it already exists for this session).
      await prisma.eventInterest.upsert({
        where: { eventId_sessionId: { eventId: id, sessionId } },
        update: {},
        create: { eventId: id, sessionId },
      });
    } else {
      // Remove the vote (no-op if it doesn't exist).
      await prisma.eventInterest.deleteMany({
        where: { eventId: id, sessionId },
      });
    }

    const votes = await prisma.eventInterest.count({ where: { eventId: id } });
    // Match the displayed heart count: in-app votes + source's external signal.
    const count = votes + event.externalInterest;

    return NextResponse.json({ ok: true, interested, count });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
