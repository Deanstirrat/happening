import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  let body: {
    description?: unknown;
    email?: unknown;
    pageUrl?: unknown;
    userAgent?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const description =
    typeof body.description === "string" ? body.description.trim().slice(0, 5000) : "";
  if (!description) {
    return NextResponse.json({ error: "Description required" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().slice(0, 320) : "";
  const pageUrl = typeof body.pageUrl === "string" ? body.pageUrl.slice(0, 2000) : null;
  const userAgent = typeof body.userAgent === "string" ? body.userAgent.slice(0, 1000) : null;

  const report = await prisma.bugReport.create({
    data: {
      description,
      email: email || null,
      pageUrl,
      userAgent,
    },
  });

  return NextResponse.json({ success: true, id: report.id });
}
