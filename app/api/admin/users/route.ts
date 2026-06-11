import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/auth";
import { logAdminAction } from "@/lib/adminAudit";

export async function GET(req: NextRequest) {
  if (!(await getAdminUser(req)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const admin = await getAdminUser(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { email, name } = await req.json().catch(() => ({}));
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const user = await prisma.user.upsert({
    where: { email: email.trim().toLowerCase() },
    create: { email: email.trim().toLowerCase(), name: name?.trim() || null },
    update: { name: name?.trim() || null },
  });

  await logAdminAction(admin, {
    action: "user.grant",
    targetType: "user",
    targetId: user.id,
    metadata: { email: user.email },
  });

  return NextResponse.json(user, { status: 201 });
}
