import { NextRequest, NextResponse } from "next/server";
import { verifyMagicLinkToken, createSession, sessionCookieOptions } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(new URL("/login?error=missing", req.url));
  }

  const email = await verifyMagicLinkToken(token);
  if (!email) {
    return NextResponse.redirect(new URL("/login?error=invalid", req.url));
  }

  const sessionToken = await createSession(email);
  const response = NextResponse.redirect(new URL("/events", req.url));
  response.cookies.set(sessionCookieOptions(sessionToken));
  return response;
}
