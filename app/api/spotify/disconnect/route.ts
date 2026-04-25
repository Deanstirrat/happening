import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const cookieStore = await cookies();
  const sid = cookieStore.get("spotify_sid")?.value;

  if (sid) {
    await prisma.spotifySession.delete({ where: { id: sid } }).catch(() => {});
    cookieStore.delete("spotify_sid");
  }

  return NextResponse.json({ ok: true });
}
