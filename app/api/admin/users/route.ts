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

  // This is the "grant access" flow, so created accounts are EDITORs explicitly
  // — the column default is now USER for self-serve signups (issue #96). An
  // existing self-serve USER being added here is promoted to EDITOR; ADMINs and
  // EDITORs keep their role.
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  const user = await prisma.user.upsert({
    where: { email: normalizedEmail },
    create: { email: normalizedEmail, name: name?.trim() || null, role: "EDITOR" },
    update: {
      name: name?.trim() || null,
      ...(existing?.role === "USER" ? { role: "EDITOR" as const } : {}),
    },
  });

  await logAdminAction(admin, {
    action: "user.grant",
    targetType: "user",
    targetId: user.id,
    metadata: { email: user.email },
  });

  return NextResponse.json(user, { status: 201 });
}
