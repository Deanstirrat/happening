import { assertPublicUrl, SsrfError } from "@/lib/ssrf";

const TIMEOUT_MS = 10_000;

// Cap on redirects we'll follow manually. Each hop is re-validated against the
// SSRF guard, so a public host can't bounce us onto an internal one.
const MAX_REDIRECTS = 5;

// Successful image requests are logged only when they exceed this latency, to
// surface slow upstreams without drowning the logs in routine 200s.
const SLOW_MS = 3_000;

/**
 * Sniff an image format from the leading bytes of a response body. Some
 * upstreams (e.g. folkyeah, some 19hz hosts) serve perfectly valid images with
 * a generic `binary/octet-stream` content-type; without this we'd reject them.
 * Returns the proper image mime type, or null if the bytes aren't a known image.
 */
function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "image/png";
  // GIF: "GIF8"
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
    return "image/gif";
  // BMP: "BM"
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
  const ascii = (a: number, b: number, c: number, d: number, off: number) =>
    bytes[off] === a && bytes[off + 1] === b && bytes[off + 2] === c && bytes[off + 3] === d;
  // WebP: "RIFF"...."WEBP"
  if (ascii(0x52, 0x49, 0x46, 0x46, 0) && ascii(0x57, 0x45, 0x42, 0x50, 8)) return "image/webp";
  // AVIF/HEIC: "ftyp" box at offset 4 with an image brand
  if (ascii(0x66, 0x74, 0x79, 0x70, 4)) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (brand === "heic" || brand === "heif" || brand === "mif1") return "image/heic";
  }
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "?";
  }
}

// Structured single-line log, aggregatable in the platform logs by outcome/host to
// track the proxy's success rate and latency over time (issue #46). Failures
// always log; successes only when unusually slow.
function log(outcome: string, host: string, ms: number, status?: number) {
  const line = `[image-proxy] ${outcome} host=${host} ms=${ms}${status ? ` status=${status}` : ""}`;
  if (outcome !== "ok" && outcome !== "ok_sniffed") console.warn(line);
  else if (ms >= SLOW_MS) console.warn(`${line} (slow)`);
}

const IMAGE_HEADERS = (contentType: string) => ({
  "Content-Type": contentType,
  // Cache at the CDN/browser for 1 hour, stale-while-revalidate for 24h
  "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
});

const FETCH_HEADERS = {
  // Mimic a browser request to avoid hotlink blocks
  "User-Agent": "Mozilla/5.0 (compatible; happening-app/1.0; +https://happening.app)",
  Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
};

/**
 * Fetch `startUrl`, following redirects manually so every hop — including the
 * initial URL — passes the SSRF guard before we connect to it. Throws
 * SsrfError for a blocked destination and a plain Error if the redirect chain
 * is too long. Returns the first non-redirect response.
 */
async function fetchValidated(startUrl: string, signal: AbortSignal): Promise<Response> {
  let target = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(target);
    const res = await fetch(target, {
      signal,
      redirect: "manual",
      headers: FETCH_HEADERS,
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      // Cancel the redirect body so the connection can be reused.
      await res.body?.cancel();
      target = new URL(location, target).toString();
      continue;
    }
    return res;
  }
  throw new Error("too many redirects");
}

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

  const host = hostOf(url);
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetchValidated(url, controller.signal);

    if (!upstream.ok) {
      log("upstream_error", host, Date.now() - start, upstream.status);
      return new Response("Upstream error", { status: upstream.status });
    }

    const contentType = upstream.headers.get("content-type") ?? "";

    // Fast path: upstream already declares an image type — stream it straight
    // through without buffering.
    if (contentType.startsWith("image/")) {
      log("ok", host, Date.now() - start);
      return new Response(upstream.body, { headers: IMAGE_HEADERS(contentType) });
    }

    // Generic/missing content-type (e.g. binary/octet-stream): buffer and sniff
    // the magic bytes so we don't reject real images. We must read the body to
    // inspect it, so we serve the buffer rather than the stream here.
    const buffer = new Uint8Array(await upstream.arrayBuffer());
    const sniffed = sniffImageType(buffer);
    if (!sniffed) {
      log(`not_image(${contentType.split(";")[0] || "none"})`, host, Date.now() - start);
      return new Response("Not an image", { status: 400 });
    }

    log("ok_sniffed", host, Date.now() - start);
    return new Response(buffer, { headers: IMAGE_HEADERS(sniffed) });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      log("timeout", host, Date.now() - start);
      return new Response("Upstream timeout", { status: 504 });
    }
    if (err instanceof SsrfError) {
      log(`blocked(${err.message})`, host, Date.now() - start);
      return new Response("Blocked URL", { status: 400 });
    }
    log("proxy_error", host, Date.now() - start);
    return new Response("Proxy error", { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
