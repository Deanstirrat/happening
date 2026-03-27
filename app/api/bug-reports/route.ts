import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const { description, pageUrl, userAgent } = await req.json();

  if (!description?.trim()) {
    return NextResponse.json({ error: "Description required" }, { status: 400 });
  }

  const report = await prisma.bugReport.create({
    data: {
      description: description.trim(),
      pageUrl: pageUrl ?? null,
      userAgent: userAgent ?? null,
    },
  });

  return NextResponse.json({ success: true, id: report.id });
}
