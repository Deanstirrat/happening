import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/auth";
import { logAdminAction } from "@/lib/adminAudit";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getAdminUser(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { featured } = await req.json();

  await prisma.event.update({
    where: { id },
    data: {
      featured,
      featuredAt: featured ? new Date() : null,
    },
  });

  await logAdminAction(admin, {
    action: featured ? "event.feature" : "event.unfeature",
    targetType: "event",
    targetId: id,
  });

  return NextResponse.json({ success: true, featured });
}
