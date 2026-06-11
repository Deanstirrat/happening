import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: { comment?: unknown; email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 2000) : "";
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 320) : "";

  const event = await prisma.event.findUnique({ where: { id }, select: { id: true } });
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const report = await prisma.eventReport.create({
    data: {
      eventId: id,
      comment: comment || null,
      email: email || null,
    },
  });

  return NextResponse.json({ success: true, id: report.id });
}
