import { NextRequest, NextResponse } from "next/server";
import { getSessionTokenFromRequest, deleteSession, clearSessionCookie } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const token = getSessionTokenFromRequest(req);
  if (token) await deleteSession(token);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(clearSessionCookie());
  return response;
}
