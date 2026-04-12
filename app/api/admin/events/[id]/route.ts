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
  await prisma.event.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
