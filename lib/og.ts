import { assertPublicUrl, SsrfError } from "@/lib/ssrf";

// Shared helpers for the generated share cards (app/events/[id]/opengraph-image).
// `next/og` (Satori + resvg) needs real font binaries and inline image data, so
// we fetch both at request time and degrade gracefully when either is missing.

const NETWORK_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 5;

// Cap the embedded flyer at ~2.5MB of source bytes. Satori inlines the image as
// base64 into the SVG it rasterizes; an unbounded flyer would balloon the render
// and risk the og bundle ceiling. Past this we fall back to the gradient.
const MAX_IMAGE_BYTES = 2_500_000;

// An older Chrome UA that predates woff2 support, so the Google Fonts CSS API
// hands back a `truetype` source. Satori only parses ttf/otf/woff — never woff2.
const FONT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_6_8) AppleWebKit/535.19 (KHTML, like Gecko) Chrome/18.0.1025.45 Safari/535.19";

/**
 * Fetch a single weight of a Google Font as a TrueType binary, subsetted to just
 * the glyphs in `text` to keep the og bundle small. Returns null on any failure
 * so the caller can render with Satori's default font rather than 500-ing.
 */
export async function loadGoogleFont(
  family: string,
  weight: number,
  text: string,
): Promise<ArrayBuffer | null> {
  try {
    const familyParam = `${family.replace(/ /g, "+")}:wght@${weight}`;
    let cssUrl = `https://fonts.googleapis.com/css2?family=${familyParam}`;
    // Subset to the glyphs we actually draw; fall back to the full face if empty.
    if (text) cssUrl += `&text=${encodeURIComponent(text)}`;

    const cssRes = await fetch(cssUrl, {
      headers: { "User-Agent": FONT_UA },
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });
    if (!cssRes.ok) return null;

    const css = await cssRes.text();
    // Google's css2 API now hands the old-Chrome UA a `woff` source (it used to
    // be `truetype`). Satori parses ttf/otf/woff, so accept `woff` too — but never
    // `woff2`, which Satori can't decode. The trailing quote keeps `woff` from
    // matching inside `woff2`.
    const match = css.match(
      /src:\s*url\((https:\/\/[^)]+)\)\s*format\('(?:truetype|opentype|woff)'\)/,
    );
    if (!match) return null;

    const fontRes = await fetch(match[1], {
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });
    if (!fontRes.ok) return null;
    return await fontRes.arrayBuffer();
  } catch {
    return null;
  }
}

/** Sniff a Satori/resvg-renderable raster format from leading bytes. */
function sniffRenderableImage(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "image/png";
  // GIF: "GIF8"
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
    return "image/gif";
  // WebP: "RIFF"...."WEBP"
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  )
    return "image/webp";
  return null;
}

/**
 * Fetch an event's flyer and return it as a base64 data URL ready to drop into an
 * `<img>` inside ImageResponse. Follows redirects manually, re-validating every
 * hop against the SSRF guard (event image URLs are externally sourced). Returns
 * null — so the card falls back to a gradient — on a blocked host, a non-image
 * body, an oversized file, or any network error.
 */
export async function loadFlyerDataUrl(rawUrl: string | null | undefined): Promise<string | null> {
  if (!rawUrl) return null;
  let target = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;
  if (!target.startsWith("http://") && !target.startsWith("https://")) return null;

  try {
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicUrl(target);
      const hopRes = await fetch(target, {
        redirect: "manual",
        signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
        headers: {
          // Mirror the image-proxy's browser-like UA to dodge hotlink blocks.
          "User-Agent": "Mozilla/5.0 (compatible; happening-app/1.0; +https://happening.app)",
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
      });
      if (hopRes.status >= 300 && hopRes.status < 400) {
        const location = hopRes.headers.get("location");
        if (!location) break;
        await hopRes.body?.cancel();
        target = new URL(location, target).toString();
        continue;
      }
      res = hopRes;
      break;
    }

    if (!res || !res.ok) return null;

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) return null;

    const mime = sniffRenderableImage(bytes);
    if (!mime) return null;

    return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch (err) {
    // SsrfError and AbortError alike: just skip the flyer, render the gradient.
    if (err instanceof SsrfError) return null;
    return null;
  }
}
