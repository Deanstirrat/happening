import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/adminAuth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason: string | undefined = body.reason;

  const event = await prisma.event.findUnique({
    where: { id },
    select: { id: true, dedupeHash: true, sourceUrl: true, title: true },
  });

  if (!event) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Upsert blocklist entry (by dedupeHash — most precise key)
  await prisma.eventBlocklist.upsert({
    where: { dedupeHash: event.dedupeHash },
    update: { reason: reason ?? null },
    create: {
      dedupeHash: event.dedupeHash,
      sourceUrl: event.sourceUrl,
      title: event.title,
      reason: reason ?? null,
    },
  });

  await prisma.event.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
