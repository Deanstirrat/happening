import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createMagicLinkToken, sendMagicLinkEmail } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { email } = await req.json().catch(() => ({}));

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalized } });

  // Always return 200 to avoid user enumeration — only send if account exists
  if (user) {
    const token = await createMagicLinkToken(normalized);
    await sendMagicLinkEmail(normalized, token);
  }

  return NextResponse.json({ ok: true });
}
