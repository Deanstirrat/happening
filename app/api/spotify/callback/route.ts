import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode, fetchAllLikedArtists } from "@/lib/spotify";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const cookieStore = await cookies();
  const savedState = cookieStore.get("spotify_state")?.value;
  cookieStore.delete("spotify_state");

  const eventsUrl = new URL("/events", req.url);

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
    const artists = await fetchAllLikedArtists(tokens.access_token);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    const session = await prisma.spotifySession.create({
      data: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        artists,
        artistCount: artists.length,
      },
    });

    cookieStore.set("spotify_sid", session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 90, // 90 days
      path: "/",
    });

    eventsUrl.searchParams.set("forYou", "true");
    return NextResponse.redirect(eventsUrl);
  } catch (err) {
    console.error("[spotify/callback]", err);
    eventsUrl.searchParams.set("spotifyError", "auth");
    return NextResponse.redirect(eventsUrl);
  }
}
