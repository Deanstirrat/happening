import { NextRequest, NextResponse } from "next/server";
import {
  verifyMagicLinkToken,
  findOrCreateUser,
  createSession,
  sessionCookieOptions,
} from "@/lib/auth";

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

  // Self-serve signup: create a USER-role account on first redemption (issue
  // #96). `?claimed=1` tells the client to migrate any anonymous interest data
  // from this browser into the account.
  await findOrCreateUser(email);

  const sessionToken = await createSession(email);
  const response = NextResponse.redirect(siteUrl("/?claimed=1"));
  response.cookies.set(sessionCookieOptions(sessionToken));
  return response;
}
