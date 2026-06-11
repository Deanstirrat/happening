import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/auth";
import { logAdminAction } from "@/lib/adminAudit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getAdminUser(req);
  if (!admin) {
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

  await logAdminAction(admin, {
    action: "event.block",
    targetType: "event",
    targetId: id,
    metadata: { title: event.title, reason: reason ?? null },
  });

  return NextResponse.json({ ok: true });
}
