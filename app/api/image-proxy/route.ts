const TIMEOUT_MS = 10_000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return new Response("Missing url parameter", { status: 400 });
  }

  // Only proxy http/https URLs
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return new Response("Invalid URL", { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Mimic a browser request to avoid hotlink blocks
        "User-Agent":
          "Mozilla/5.0 (compatible; happening-app/1.0; +https://happening.app)",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });

    if (!upstream.ok) {
      return new Response("Upstream error", { status: upstream.status });
    }

    const contentType = upstream.headers.get("content-type") ?? "image/jpeg";

    // Only proxy image responses
    if (!contentType.startsWith("image/")) {
      return new Response("Not an image", { status: 400 });
    }

    return new Response(upstream.body, {
      headers: {
        "Content-Type": contentType,
        // Cache at the CDN/browser for 1 hour, stale-while-revalidate for 24h
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return new Response("Upstream timeout", { status: 504 });
    }
    return new Response("Proxy error", { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
