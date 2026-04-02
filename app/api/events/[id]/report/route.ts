import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { comment, email } = await req.json();

  const event = await prisma.event.findUnique({ where: { id }, select: { id: true } });
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const report = await prisma.eventReport.create({
    data: {
      eventId: id,
      comment: comment?.trim() || null,
      email: email?.trim() || null,
    },
  });

  return NextResponse.json({ success: true, id: report.id });
}
