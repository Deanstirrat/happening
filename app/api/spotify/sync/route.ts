import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { streamLikedArtists, refreshAccessToken } from "@/lib/spotify";

export async function GET() {
  const cookieStore = await cookies();
  const sid = cookieStore.get("spotify_sid")?.value;

  if (!sid) {
    return new Response("Unauthorized", { status: 401 });
  }

  const session = await prisma.spotifySession.findUnique({ where: { id: sid } });
  if (!session) {
    return new Response("Session not found", { status: 404 });
  }

  const encoder = new TextEncoder();

  function send(data: object): Uint8Array {
    return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
  }

  // Session already synced — return immediate complete
  if (session.synced) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(send({ type: "complete", count: session.artistCount }));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let accessToken = session.accessToken;

        if (session.expiresAt <= new Date()) {
          const refreshed = await refreshAccessToken(session.refreshToken);
          accessToken = refreshed.access_token;
          await prisma.spotifySession.update({
            where: { id: sid },
            data: {
              accessToken: refreshed.access_token,
              expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
            },
          });
        }

        const allArtistsLower: string[] = [];

        for await (const batch of streamLikedArtists(accessToken)) {
          allArtistsLower.push(...batch.map((n) => n.toLowerCase()));
          controller.enqueue(send({ type: "artists", names: batch }));
        }

        await prisma.spotifySession.update({
          where: { id: sid },
          data: {
            artists: allArtistsLower,
            artistCount: allArtistsLower.length,
            synced: true,
          },
        });

        controller.enqueue(send({ type: "complete", count: allArtistsLower.length }));
      } catch (err) {
        console.error("[spotify/sync]", err);
        controller.enqueue(send({ type: "error", message: "Failed to fetch artists" }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
