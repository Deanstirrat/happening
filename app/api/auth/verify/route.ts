import { NextRequest, NextResponse } from "next/server";
import { verifyMagicLinkToken, createSession, sessionCookieOptions } from "@/lib/auth";

function siteUrl(path: string) {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://happeningsf.now";
  return `${base.replace(/\/$/, "")}${path}`;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(siteUrl("/login?error=missing"));
  }

  const email = await verifyMagicLinkToken(token);
  if (!email) {
    return NextResponse.redirect(siteUrl("/login?error=invalid"));
  }

  const sessionToken = await createSession(email);
  const response = NextResponse.redirect(siteUrl("/"));
  response.cookies.set(sessionCookieOptions(sessionToken));
  return response;
}
