import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/auth";
import { logAdminAction } from "@/lib/adminAudit";

export async function GET(req: NextRequest) {
  if (!(await getAdminUser(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const events = await prisma.event.findMany({
    where: { status: "PENDING" },
    orderBy: { scrapedAt: "desc" },
    select: {
      id: true,
      title: true,
      startDate: true,
      venueName: true,
      venueAddress: true,
      neighborhood: true,
      category: true,
      price: true,
      isFree: true,
      description: true,
      sourceUrl: true,
      tags: true,
      submitterNote: true,
      scrapedAt: true,
    },
  });

  return NextResponse.json({ events });
}

export async function POST(req: NextRequest) {
  const admin = await getAdminUser(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, action } = await req.json();

  if (!id || !["approve", "reject", "delete"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (action === "delete") {
    await prisma.event.delete({ where: { id } });
    await logAdminAction(admin, {
      action: "submission.delete",
      targetType: "event",
      targetId: id,
    });
    return NextResponse.json({ success: true, status: "DELETED" });
  }

  const status = action === "approve" ? "PUBLISHED" : "REJECTED";
  await prisma.event.update({ where: { id }, data: { status } });

  await logAdminAction(admin, {
    action: action === "approve" ? "submission.approve" : "submission.reject",
    targetType: "event",
    targetId: id,
    metadata: { status },
  });

  return NextResponse.json({ success: true, status });
}
