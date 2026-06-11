import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/auth";
import { logAdminAction } from "@/lib/adminAudit";

// Toggle a source's enabled flag (issue #101) — replaces the manual DB edit that
// was previously the only way to pause a misbehaving scraper.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getAdminUser(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { enabled } = await req.json();
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  const source = await prisma.source.findUnique({
    where: { id },
    select: { slug: true },
  });
  if (!source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  await prisma.source.update({ where: { id }, data: { enabled } });

  await logAdminAction(admin, {
    action: enabled ? "source.enable" : "source.disable",
    targetType: "source",
    targetId: id,
    metadata: { slug: source.slug },
  });

  return NextResponse.json({ ok: true, enabled });
}
