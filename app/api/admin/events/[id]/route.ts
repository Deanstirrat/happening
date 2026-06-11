import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/adminAuth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();

  const {
    title,
    description,
    startDate,
    endDate,
    allDay,
    venueName,
    venueAddress,
    neighborhood,
    category,
    price,
    isFree,
    tags,
    sourceUrl,
    imageUrl,
    status,
    recurringType,
  } = body;

  await prisma.event.update({
    where: { id },
    data: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(startDate !== undefined && { startDate: new Date(startDate) }),
      ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
      ...(allDay !== undefined && { allDay }),
      ...(venueName !== undefined && { venueName }),
      ...(venueAddress !== undefined && { venueAddress }),
      ...(neighborhood !== undefined && { neighborhood }),
      ...(category !== undefined && { category }),
      ...(price !== undefined && { price }),
      ...(isFree !== undefined && { isFree }),
      ...(tags !== undefined && { tags }),
      ...(sourceUrl !== undefined && { sourceUrl }),
      ...(imageUrl !== undefined && { imageUrl }),
      ...(status !== undefined && { status }),
      // Keep deletedAt consistent with status: stamp it when an event is trashed,
      // clear it when restored to any other status (the undo / restore actions).
      ...(status !== undefined && { deletedAt: status === "TRASHED" ? new Date() : null }),
      ...(recurringType !== undefined && { recurringType: recurringType || null }),
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // `?hard=1` permanently removes the row ("delete forever" in the trash UI).
  // The default is a soft delete (issue #103): status → TRASHED + deletedAt stamp,
  // so a mis-click is recoverable. We return the prior status so the client can
  // offer an immediate one-click undo that restores it exactly.
  const hard = new URL(req.url).searchParams.get("hard") === "1";
  if (hard) {
    await prisma.event.delete({ where: { id } });
    return NextResponse.json({ ok: true, hard: true });
  }

  const existing = await prisma.event.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.event.update({
    where: { id },
    data: { status: "TRASHED", deletedAt: new Date() },
  });

  return NextResponse.json({ ok: true, previousStatus: existing.status });
}
