import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/auth";
import { logAdminAction } from "@/lib/adminAudit";
import { CostService } from "@prisma/client";

const VALID_SERVICES = new Set<CostService>([
  "CLAUDE_CODE",
  "CLAUDE_API",
  "APIFY",
  "RAILWAY",
  "OTHER",
]);

export async function POST(req: NextRequest) {
  const admin = await getAdminUser(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { service, amount, billingMonth, notes } = await req.json();

  if (!VALID_SERVICES.has(service)) {
    return NextResponse.json({ error: "Invalid service" }, { status: 400 });
  }
  if (typeof amount !== "number" || amount <= 0) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }
  if (!billingMonth || isNaN(Date.parse(billingMonth))) {
    return NextResponse.json({ error: "Invalid billingMonth" }, { status: 400 });
  }

  const entry = await prisma.costEntry.create({
    data: {
      service,
      amount,
      billingMonth: new Date(billingMonth),
      notes: notes?.trim() || null,
    },
  });

  await logAdminAction(admin, {
    action: "cost.create",
    targetType: "cost",
    targetId: entry.id,
    metadata: { service, amount },
  });

  return NextResponse.json({ entry });
}
