import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEditorUser } from "@/lib/auth";

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

const DATE_FIELDS = new Set(["startDate", "endDate"]);
const ARRAY_FIELDS = new Set(["tags", "performers"]);
const PATCHABLE_FIELDS = new Set([
  "title", "description", "imageUrl",
  "startDate", "endDate", "allDay",
  "venueName", "venueAddress", "city", "neighborhood",
  "category", "price", "isFree",
  "tags", "performers", "status", "recurringType", "sourceUrl",
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getEditorUser(req);
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!PATCHABLE_FIELDS.has(key)) continue;
    if (DATE_FIELDS.has(key)) {
      data[key] = value ? new Date(value as string) : null;
    } else if (ARRAY_FIELDS.has(key)) {
      data[key] = Array.isArray(value) ? value : [];
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getEditorUser(req);
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  await prisma.event.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
