import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/auth";
import { logAdminAction } from "@/lib/adminAudit";
import { ReportStatus } from "@prisma/client";

const VALID = new Set<string>(Object.values(ReportStatus));

/**
 * Update event report triage status (issue #104). Accepts a single `id` or a list
 * of `ids` (bulk mark-resolved), plus the target `status`.
 */
export async function PATCH(req: NextRequest) {
  const admin = await getAdminUser(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { id, ids, status } = body as { id?: string; ids?: string[]; status?: string };

  if (!status || !VALID.has(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const targetIds = Array.isArray(ids) ? ids : id ? [id] : [];
  if (targetIds.length === 0) {
    return NextResponse.json({ error: "id or ids is required" }, { status: 400 });
  }

  const { count } = await prisma.eventReport.updateMany({
    where: { id: { in: targetIds } },
    data: { status: status as ReportStatus },
  });

  await logAdminAction(admin, {
    action: "event-report.status",
    targetType: "event-report",
    targetId: targetIds.length === 1 ? targetIds[0] : undefined,
    metadata: { status, ids: targetIds, count },
  });

  return NextResponse.json({ ok: true, count });
}
