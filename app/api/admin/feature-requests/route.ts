import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/auth";
import { logAdminAction } from "@/lib/adminAudit";

export async function PATCH(req: NextRequest) {
  const admin = await getAdminUser(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { id, status, action } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  // Apply suggested edits and feature the event in one action
  if (action === "apply-and-feature") {
    const request = await prisma.featuredRequest.findUnique({ where: { id } });
    if (!request?.eventId) {
      return NextResponse.json({ error: "No linked event" }, { status: 400 });
    }

    const edits = (request.suggestedEdits as Record<string, string>) ?? {};
    const eventUpdate: Record<string, unknown> = {
      featured: true,
      featuredAt: new Date(),
    };
    // Apply only safe editable fields
    const allowedFields = ["description", "venueName", "price", "sourceUrl"];
    for (const field of allowedFields) {
      if (edits[field] !== undefined) {
        eventUpdate[field] = edits[field];
      }
    }
    if (edits.tags !== undefined) {
      eventUpdate.tags = edits.tags
        .split(",")
        .map((t: string) => t.trim())
        .filter(Boolean);
    }

    await Promise.all([
      prisma.event.update({ where: { id: request.eventId }, data: eventUpdate }),
      prisma.featuredRequest.update({ where: { id }, data: { status: "CLOSED" } }),
    ]);

    await logAdminAction(admin, {
      action: "feature-request.apply-and-feature",
      targetType: "feature-request",
      targetId: id,
      metadata: { eventId: request.eventId },
    });

    return NextResponse.json({ success: true, action: "apply-and-feature" });
  }

  // Standard status update
  if (!status || !["NEW", "CONTACTED", "CLOSED"].includes(status)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  await prisma.featuredRequest.update({ where: { id }, data: { status } });

  await logAdminAction(admin, {
    action: "feature-request.status",
    targetType: "feature-request",
    targetId: id,
    metadata: { status },
  });

  return NextResponse.json({ success: true, status });
}
