import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const cookieStore = await cookies();
  const sid = cookieStore.get("spotify_sid")?.value;

  if (!sid) return NextResponse.json({ connected: false });

  const session = await prisma.spotifySession.findUnique({
    where: { id: sid },
    select: { artistCount: true },
  });

  if (!session) return NextResponse.json({ connected: false });

  return NextResponse.json({ connected: true, artistCount: session.artistCount });
}
