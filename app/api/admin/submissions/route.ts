import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/auth";
import { logAdminAction } from "@/lib/adminAudit";

export async function GET(req: NextRequest) {
  if (!(await getAdminUser(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const events = await prisma.event.findMany({
    where: { status: "PENDING" },
    orderBy: { scrapedAt: "desc" },
    select: {
      id: true,
      title: true,
      startDate: true,
      venueName: true,
      venueAddress: true,
      neighborhood: true,
      category: true,
      price: true,
      isFree: true,
      description: true,
      sourceUrl: true,
      tags: true,
      submitterNote: true,
      scrapedAt: true,
    },
  });

  return NextResponse.json({ events });
}

// Approve/reject/delete/feature one or many pending submissions. Accepts either
// `{ id, action }` (single, used by the per-row buttons) or `{ ids, action }`
// (bulk multi-select, issue #100). Both shapes share one batched code path.
//
// "feature" publishes *and* pins in one step — featuring only makes sense for a
// PUBLISHED event, and from the pending queue an admin who wants to feature an
// event always means "approve it and feature it".
const ACTIONS = ["approve", "reject", "delete", "feature"] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(req: NextRequest) {
  const admin = await getAdminUser(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const action = body.action as Action;
  // Normalize both shapes to a deduped id list.
  const ids: string[] = [
    ...new Set<string>(
      Array.isArray(body.ids) ? body.ids : body.id ? [body.id] : []
    ),
  ];

  if (ids.length === 0 || !ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const where = { id: { in: ids } };
  let count: number;

  if (action === "delete") {
    // Hard delete, matching the single-row "Delete" button — pending junk is not
    // worth keeping in the trash, and the UI warns it cannot be undone.
    ({ count } = await prisma.event.deleteMany({ where }));
  } else if (action === "feature") {
    ({ count } = await prisma.event.updateMany({
      where,
      data: { status: "PUBLISHED", featured: true, featuredAt: new Date() },
    }));
  } else {
    const status = action === "approve" ? "PUBLISHED" : "REJECTED";
    ({ count } = await prisma.event.updateMany({ where, data: { status } }));
  }

  await logAdminAction(admin, {
    action: `submission.${action}`,
    targetType: "event",
    // Keep single-target logs queryable by targetId; bulk logs carry the id list.
    ...(ids.length === 1 ? { targetId: ids[0] } : {}),
    metadata: { count, ...(ids.length > 1 ? { ids } : {}) },
  });

  return NextResponse.json({ success: true, count });
}
