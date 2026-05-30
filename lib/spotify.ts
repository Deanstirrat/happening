const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

function credentials(): string {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET");
  return Buffer.from(`${id}:${secret}`).toString("base64");
}

export function getSpotifyAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    response_type: "code",
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
    state,
    scope: "user-library-read",
  });
  return `${SPOTIFY_AUTH_URL}?${params}`;
}

export async function exchangeCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials()}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify token exchange failed ${res.status}: ${text}`);
  }
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
}> {
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials()}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify token refresh failed ${res.status}: ${text}`);
  }
  return res.json();
}

type TracksPage = {
  items: Array<{ track: { artists: Array<{ name: string }> } }>;
  next: string | null;
};

// Yields batches of unique artist display names (original casing) as each page loads.
// Caller is responsible for deduplication across calls if needed.
export async function* streamLikedArtists(accessToken: string): AsyncGenerator<string[]> {
  let url: string | null = "https://api.spotify.com/v1/me/tracks?limit=50";
  const seen = new Set<string>();

  while (url) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(`Spotify tracks fetch failed: ${response.status}`);
    const data: TracksPage = await response.json();

    const batch: string[] = [];
    for (const item of data.items ?? []) {
      for (const artist of item.track?.artists ?? []) {
        if (artist.name) {
          const lower = artist.name.toLowerCase();
          if (!seen.has(lower)) {
            seen.add(lower);
            batch.push(artist.name);
          }
        }
      }
    }

    if (batch.length > 0) yield batch;
    url = data.next ?? null;
  }
}

export async function fetchAllLikedArtists(accessToken: string): Promise<string[]> {
  const artists: string[] = [];
  for await (const batch of streamLikedArtists(accessToken)) {
    artists.push(...batch.map((n) => n.toLowerCase()));
  }
  return artists;
}
