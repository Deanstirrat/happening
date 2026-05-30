import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode } from "@/lib/spotify";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const cookieStore = await cookies();
  const savedState = cookieStore.get("spotify_state")?.value;
  cookieStore.delete("spotify_state");

  // Respect reverse-proxy headers (Railway serves on 0.0.0.0 internally)
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(/:$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const base = `${proto}://${host}`;
  const eventsUrl = new URL("/events", base);

  if (error || !code) {
    console.error("[spotify/callback] OAuth error:", error);
    return NextResponse.redirect(eventsUrl);
  }

  if (!state || state !== savedState) {
    console.error("[spotify/callback] State mismatch");
    eventsUrl.searchParams.set("spotifyError", "state");
    return NextResponse.redirect(eventsUrl);
  }

  try {
    const tokens = await exchangeCode(code);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Create a pending session — artist sync happens on the connecting page via SSE
    const session = await prisma.spotifySession.create({
      data: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        artists: [],
        artistCount: 0,
        synced: false,
      },
    });

    cookieStore.set("spotify_sid", session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 90, // 90 days
      path: "/",
    });

    return NextResponse.redirect(new URL("/spotify/connecting", base));
  } catch (err) {
    console.error("[spotify/callback]", err);
    eventsUrl.searchParams.set("spotifyError", "auth");
    return NextResponse.redirect(eventsUrl);
  }
}
