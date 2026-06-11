import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/auth";
import { logAdminAction } from "@/lib/adminAudit";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getAdminUser(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await prisma.costEntry.delete({ where: { id } });

  await logAdminAction(admin, {
    action: "cost.delete",
    targetType: "cost",
    targetId: id,
  });

  return NextResponse.json({ success: true });
}
