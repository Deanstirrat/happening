import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/auth";
import { logAdminAction } from "@/lib/adminAudit";
import type { ReportStatus } from "@prisma/client";

const STATUSES: ReportStatus[] = ["NEW", "IN_PROGRESS", "RESOLVED"];

// Event columns an organizer correction may write. Mirrors the submit whitelist
// (app/api/events/[id]/corrections) and the editable modal fields.
const DATE_FIELDS = new Set(["startDate", "endDate"]);
const APPLYABLE_FIELDS = new Set([
  "startDate",
  "endDate",
  "allDay",
  "venueName",
  "price",
  "imageUrl",
  "description",
  "tags",
]);

export async function PATCH(req: NextRequest) {
  const admin = await getAdminUser(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const { id, action, status } = body ?? {};

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  // Apply the suggested edits to the linked event, then resolve the correction.
  if (action === "apply") {
    const correction = await prisma.eventCorrection.findUnique({ where: { id } });
    if (!correction) {
      return NextResponse.json({ error: "Correction not found" }, { status: 404 });
    }

    const edits = (correction.suggestedEdits as Record<string, unknown>) ?? {};
    const eventUpdate: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(edits)) {
      if (!APPLYABLE_FIELDS.has(key)) continue;
      if (DATE_FIELDS.has(key)) {
        const d = value ? new Date(value as string) : null;
        if (d && Number.isNaN(d.getTime())) continue; // skip unparseable dates
        eventUpdate[key] = d;
      } else if (key === "tags") {
        eventUpdate.tags = Array.isArray(value)
          ? value.map((t) => String(t).trim()).filter(Boolean)
          : typeof value === "string"
            ? value.split(",").map((t) => t.trim()).filter(Boolean)
            : [];
      } else if (key === "allDay") {
        eventUpdate.allDay = Boolean(value);
      } else {
        eventUpdate[key] = value;
      }
    }

    if (Object.keys(eventUpdate).length === 0) {
      return NextResponse.json({ error: "No applyable edits" }, { status: 400 });
    }

    await Promise.all([
      prisma.event.update({ where: { id: correction.eventId }, data: eventUpdate }),
      prisma.eventCorrection.update({ where: { id }, data: { status: "RESOLVED" } }),
    ]);

    await logAdminAction(admin, {
      action: "correction.apply",
      targetType: "event-correction",
      targetId: id,
      metadata: { eventId: correction.eventId, fields: Object.keys(eventUpdate) },
    });

    return NextResponse.json({ success: true, action: "apply" });
  }

  // Status change (e.g. dismiss → RESOLVED without applying).
  if (!STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  await prisma.eventCorrection.update({ where: { id }, data: { status } });

  await logAdminAction(admin, {
    action: "correction.status",
    targetType: "event-correction",
    targetId: id,
    metadata: { status },
  });

  return NextResponse.json({ success: true, status });
}
