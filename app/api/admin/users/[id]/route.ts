import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/auth";
import { logAdminAction } from "@/lib/adminAudit";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getAdminUser(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const target = await prisma.user.findUnique({
    where: { id },
    select: { email: true },
  });
  await prisma.user.delete({ where: { id } });

  await logAdminAction(admin, {
    action: "user.revoke",
    targetType: "user",
    targetId: id,
    metadata: { email: target?.email },
  });

  return NextResponse.json({ ok: true });
}
