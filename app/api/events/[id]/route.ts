import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const event = await prisma.event.findUnique({
    where: { id },
    include: { source: { select: { slug: true, name: true, url: true } } },
  });

  if (!event) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(event);
}

const PATCHABLE_FIELDS = new Set([
  "title",
  "description",
  "imageUrl",
  "startDate",
  "endDate",
  "venueName",
  "venueAddress",
  "neighborhood",
  "price",
  "isFree",
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!PATCHABLE_FIELDS.has(key)) continue;
    if (key === "startDate" || key === "endDate") {
      data[key] = value ? new Date(value as string) : null;
    } else {
      data[key] = value;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const event = await prisma.event.update({ where: { id }, data });
  return NextResponse.json(event);
}
