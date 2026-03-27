import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/adminAuth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkAuth(req)) {
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

  return NextResponse.json({ success: true, featured });
}
