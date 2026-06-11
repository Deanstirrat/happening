import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/adminAuth";
import { ReportStatus } from "@prisma/client";

const VALID = new Set<string>(Object.values(ReportStatus));

/**
 * Update bug report triage status (issue #104). Accepts a single `id` or a list
 * of `ids` (bulk mark-resolved), plus the target `status`.
 */
export async function PATCH(req: NextRequest) {
  if (!checkAuth(req)) {
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

  const { count } = await prisma.bugReport.updateMany({
    where: { id: { in: targetIds } },
    data: { status: status as ReportStatus },
  });

  return NextResponse.json({ ok: true, count });
}
