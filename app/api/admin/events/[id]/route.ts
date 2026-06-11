import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/auth";
import { logAdminAction } from "@/lib/adminAudit";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getAdminUser(req);
  if (!admin) {
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
      ...(recurringType !== undefined && { recurringType: recurringType || null }),
    },
  });

  await logAdminAction(admin, {
    action: "event.edit",
    targetType: "event",
    targetId: id,
    metadata: { fields: Object.keys(body), ...(status !== undefined && { status }) },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getAdminUser(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const event = await prisma.event.findUnique({
    where: { id },
    select: { title: true },
  });
  await prisma.event.delete({ where: { id } });

  await logAdminAction(admin, {
    action: "event.delete",
    targetType: "event",
    targetId: id,
    metadata: { title: event?.title },
  });

  return NextResponse.json({ ok: true });
}
