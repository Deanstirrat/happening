import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// Fields an organizer may suggest a fix for. Mirrors the editable fields in the
// event-page report modal and the admin apply whitelist (app/api/admin/corrections).
const ALLOWED_EDIT_FIELDS = new Set([
  "startDate",
  "endDate",
  "allDay",
  "venueName",
  "price",
  "imageUrl",
  "description",
  "tags",
]);

// Sanitize the client-supplied edits: keep only whitelisted keys and clamp
// string lengths. Values are stored as-is (strings/bool/array) and only coerced
// to the right column types when an admin applies them.
function sanitizeEdits(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!ALLOWED_EDIT_FIELDS.has(key)) continue;
    if (key === "allDay") {
      out[key] = Boolean(value);
    } else if (key === "tags") {
      if (Array.isArray(value)) {
        out[key] = value.map((t) => String(t).trim().slice(0, 60)).filter(Boolean).slice(0, 25);
      } else if (typeof value === "string") {
        out[key] = value
          .split(",")
          .map((t) => t.trim().slice(0, 60))
          .filter(Boolean)
          .slice(0, 25);
      }
    } else if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) out[key] = trimmed.slice(0, 4000);
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: { suggestedEdits?: unknown; comment?: unknown; email?: unknown; isOrganizer?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const suggestedEdits = sanitizeEdits(body.suggestedEdits);
  const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 2000) : "";
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 320) : "";
  const isOrganizer = body.isOrganizer === true;

  // A correction must actually suggest at least one field change — otherwise the
  // client should have hit the plain /report endpoint.
  if (!suggestedEdits) {
    return NextResponse.json({ error: "No suggested edits provided" }, { status: 400 });
  }

  const event = await prisma.event.findUnique({ where: { id }, select: { id: true } });
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const correction = await prisma.eventCorrection.create({
    data: {
      eventId: id,
      suggestedEdits: suggestedEdits as Prisma.InputJsonValue,
      comment: comment || null,
      email: email || null,
      isOrganizer,
    },
  });

  return NextResponse.json({ success: true, id: correction.id });
}
