import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/auth";

const client = new Anthropic({ timeout: 30_000 });

const CONCURRENCY = 3;
const DESC_MIN_LENGTH = 120;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// Machine callers (Vercel cron) authenticate with the CRON_SECRET bearer token;
// human admins authenticate with their session cookie + ADMIN role.
async function checkCronOrAdminAuth(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth === `Bearer ${cronSecret}`) return true;
  }
  return (await getAdminUser(req)) !== null;
}

// ─── Page scraping ────────────────────────────────────────────────────────────

interface PageMeta {
  ok: boolean;
  status: number;
  finalUrl: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  bodyText: string;
}

function parseMeta(html: string): Pick<PageMeta, "ogTitle" | "ogDescription" | "ogImage" | "bodyText"> {
  const attr = (tag: string, prop: string) => {
    const m =
      html.match(new RegExp(`<meta[^>]+${prop}=["'][^"']*og:${tag}["'][^>]+content=["']([^"']+)["']`, "i")) ??
      html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${prop}=["'][^"']*og:${tag}["']`, "i"));
    return m?.[1]?.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim() ?? null;
  };

  const plainTitle =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)?.[1] ??
    null;

  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3000);

  return {
    ogTitle: attr("title", "property"),
    ogDescription: attr("description", "property") ?? plainTitle?.replace(/&amp;/g, "&").replace(/&#39;/g, "'").trim() ?? null,
    ogImage: attr("image", "property"),
    bodyText,
  };
}

async function fetchPageMeta(url: string): Promise<PageMeta> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    if (!res.ok) {
      return { ok: false, status: res.status, finalUrl: res.url, ogTitle: null, ogDescription: null, ogImage: null, bodyText: "" };
    }
    const html = await res.text();
    return { ok: true, status: res.status, finalUrl: res.url, ...parseMeta(html) };
  } catch {
    return { ok: false, status: 0, finalUrl: null, ogTitle: null, ogDescription: null, ogImage: null, bodyText: "" };
  }
}

// ─── Image validation ─────────────────────────────────────────────────────────

async function isImageAccessible(url: string): Promise<boolean> {
  const check = async (method: "HEAD" | "GET") => {
    try {
      const res = await fetch(url, {
        method,
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(8_000),
        redirect: "follow",
      });
      if (!res.ok) return false;
      const ct = res.headers.get("content-type") ?? "";
      return ct.startsWith("image/") || ct === "application/octet-stream";
    } catch {
      return false;
    }
  };
  return (await check("HEAD")) || (await check("GET"));
}

// A `/`-rooted path is a locally-bundled placeholder (e.g. "/sfrecpark-default.jpg"),
// not a real per-event image. Real scraped images are always absolute http(s) URLs.
function isDefaultImage(url: string | null): boolean {
  return !!url && !/^https?:\/\//i.test(url);
}

function resolveImageUrl(raw: string): string {
  const nextParam = raw.match(/[?&]url=([^&]+)/);
  if (nextParam) {
    const inner = decodeURIComponent(nextParam[1]);
    try {
      const parsed = new URL(inner);
      if (!parsed.pathname.includes("_next")) {
        return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
      }
    } catch {
      // fall through
    }
    return inner.split("?")[0];
  }
  return raw;
}

// ─── AI description ───────────────────────────────────────────────────────────

async function generateDescription(
  title: string,
  venueName: string | null,
  startDate: Date,
  pageText: string
): Promise<string | null> {
  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: `Write a 2-3 sentence description for this San Francisco event. Be specific: mention genre, vibe, performers, or what makes it worth attending. No marketing fluff.

Event: ${title}
Venue: ${venueName ?? "unknown"}
Date: ${startDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}

Page content (for context):
${pageText.slice(0, 1800)}

Reply with only the description text. No quotes, no label prefix.`,
        },
      ],
    });
    const text = ((msg.content[0] as Anthropic.TextBlock).text ?? "").trim();
    return text.length > 30 ? text : null;
  } catch {
    return null;
  }
}

// ─── Web image search ──────────────────────────────────────────────────────────

// Pull http(s) URLs out of the model's free-text reply.
function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)<>"']+/gi) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const url = m.replace(/[.,)]+$/, ""); // strip trailing punctuation
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out.slice(0, 3);
}

// Last resort when neither the stored image nor the source page's og:image works:
// ask Claude (with web search) to find the event's real listing page elsewhere on
// the web, then reuse our trusted og:image extraction on that page. Returns a
// validated absolute image URL, or null if nothing confident was found.
async function findImageViaWebSearch(event: {
  title: string;
  venueName: string | null;
  city: string;
  startDate: Date;
  description: string | null;
}): Promise<string | null> {
  const dateStr = event.startDate.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  try {
    const msg = await client.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
        messages: [
          {
            role: "user",
            content: `Find a promotional image for this specific event by locating its official listing page on the web.

Event: ${event.title}
Venue: ${event.venueName ?? "unknown"}
City: ${event.city}
Date: ${dateStr}
${event.description ? `Details: ${event.description.slice(0, 300)}` : ""}

Search the web and identify up to 3 pages that are unambiguously about THIS exact event — matching the title, venue, and date. Good sources: the venue's own event page, a ticketing page (Eventbrite, Dice, Resident Advisor, Bandsintown, Songkick), or the promoter's post. These pages carry a representative event image.

Reply with ONLY the page URLs, one per line (max 3). Do NOT include search-result pages, homepages, or pages about a different event. If you cannot confidently find a page about this exact event, reply with exactly: NONE`,
          },
        ],
      },
      { timeout: 45_000 }
    );

    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    if (/\bNONE\b/.test(text) && !/https?:\/\//i.test(text)) return null;

    for (const url of extractUrls(text)) {
      // A direct image URL can be validated as-is.
      if (/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url)) {
        if (await isImageAccessible(url)) return url;
        continue;
      }
      // Otherwise treat it as a page and extract its og:image.
      const meta = await fetchPageMeta(url);
      if (meta.ogImage) {
        const candidate = resolveImageUrl(meta.ogImage);
        if (await isImageAccessible(candidate)) return candidate;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Per-event enrichment ─────────────────────────────────────────────────────

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  sourceUrl: string;
  imageUrl: string | null;
  venueName: string | null;
  city: string;
  startDate: Date;
}

interface EnrichResult {
  id: string;
  title: string;
  sourceOk: boolean;
  sourceStatus: number;
  imageFixed: boolean;
  imageSource: "og" | "websearch" | null;
  unfeatured: boolean;
  descriptionEnriched: boolean;
  descriptionSource: "og" | "ai" | null;
  titleMismatch: string | null;
}

async function enrichEvent(event: EventRow): Promise<EnrichResult> {
  const result: EnrichResult = {
    id: event.id,
    title: event.title,
    sourceOk: true,
    sourceStatus: 200,
    imageFixed: false,
    imageSource: null,
    unfeatured: false,
    descriptionEnriched: false,
    descriptionSource: null,
    titleMismatch: null,
  };

  const meta = await fetchPageMeta(event.sourceUrl);
  result.sourceOk = meta.ok;
  result.sourceStatus = meta.status;

  if (meta.ogTitle && meta.ogTitle.toLowerCase() !== event.title.toLowerCase()) {
    const ogNorm = meta.ogTitle.replace(/\s+/g, " ").slice(0, 80);
    const evNorm = event.title.replace(/\s+/g, " ").slice(0, 80);
    if (!ogNorm.includes(evNorm) && !evNorm.includes(ogNorm)) {
      result.titleMismatch = meta.ogTitle;
    }
  }

  const updates: Partial<{ description: string; imageUrl: string | null; featured: boolean }> = {};

  // Image cascade: keep a usable real image → og:image → web search → un-feature.
  // A `/`-rooted default (e.g. sfrecpark placeholder) counts as "no real image".
  let haveUsableImage = false;
  if (event.imageUrl && !isDefaultImage(event.imageUrl)) {
    haveUsableImage = await isImageAccessible(event.imageUrl);
    if (!haveUsableImage) {
      // Existing real image is broken — clear it and look for a replacement.
      updates.imageUrl = null;
    }
  }

  // og:image from the event's own source page.
  if (!haveUsableImage && meta.ogImage) {
    const candidate = resolveImageUrl(meta.ogImage);
    if (await isImageAccessible(candidate)) {
      updates.imageUrl = candidate;
      haveUsableImage = true;
      result.imageFixed = true;
      result.imageSource = "og";
    }
  }

  // Web search: find the event's real listing page elsewhere → its og:image.
  if (!haveUsableImage) {
    const found = await findImageViaWebSearch(event);
    if (found) {
      updates.imageUrl = found;
      haveUsableImage = true;
      result.imageFixed = true;
      result.imageSource = "websearch";
    }
  }

  // Still nothing usable → a featured event with no image isn't worth featuring.
  // Leave a `/`-rooted default in place as a placeholder; only drop the featured flag.
  if (!haveUsableImage) {
    updates.featured = false;
    result.unfeatured = true;
  }

  const existingDesc = event.description ?? "";
  const needsDesc = existingDesc.length < DESC_MIN_LENGTH;

  if (needsDesc) {
    const ogDesc = meta.ogDescription;
    if (ogDesc && ogDesc.length >= DESC_MIN_LENGTH) {
      updates.description = ogDesc.slice(0, 500);
      result.descriptionEnriched = true;
      result.descriptionSource = "og";
    } else if (meta.ok && meta.bodyText.length > 100) {
      const aiDesc = await generateDescription(event.title, event.venueName, event.startDate, meta.bodyText);
      if (aiDesc) {
        updates.description = aiDesc;
        result.descriptionEnriched = true;
        result.descriptionSource = "ai";
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    await prisma.event.update({ where: { id: event.id }, data: updates });
  }

  return result;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

async function runEnrichFeatured() {
  console.log("[enrich-featured] Starting — querying featured events...");
  const now = new Date();
  const events = await Promise.race([
    prisma.event.findMany({
      where: { featured: true, startDate: { gte: now }, status: "PUBLISHED" },
      select: {
        id: true,
        title: true,
        description: true,
        sourceUrl: true,
        imageUrl: true,
        venueName: true,
        city: true,
        startDate: true,
      },
      orderBy: { featuredAt: "desc" },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("DB query timed out after 15s")), 15_000)
    ),
  ]);
  console.log(`[enrich-featured] Query complete — ${events.length} event(s) found.`);

  if (events.length === 0) {
    console.log("[enrich-featured] No upcoming featured events found.");
    return { ok: true, processed: 0, imagesFixed: 0, imagesFromSearch: 0, unfeatured: 0, unfeaturedDetails: [], descriptionsAdded: 0, brokenSources: 0, titleMismatches: [] };
  }

  console.log(`\n[enrich-featured] === Enriching ${events.length} featured event(s) ===\n`);

  const results: EnrichResult[] = [];
  let i = 0;

  for (let batch = 0; batch < events.length; batch += CONCURRENCY) {
    const chunk = events.slice(batch, batch + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (event) => {
        i++;
        console.log(`[enrich-featured] [${i}/${events.length}] ${event.title}`);
        const EVENT_TIMEOUT_MS = 60_000;
        const r = await Promise.race([
          enrichEvent(event),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("event timeout")), EVENT_TIMEOUT_MS)
          ),
        ]).catch((err: Error) => {
          console.log(`[enrich-featured]   ⚠ skipped (${err.message})`);
          return {
            id: event.id,
            title: event.title,
            sourceOk: false,
            sourceStatus: 0,
            imageFixed: false,
            imageSource: null,
            unfeatured: false,
            descriptionEnriched: false,
            descriptionSource: null,
            titleMismatch: null,
          } satisfies EnrichResult;
        });

        const sourceLabel = r.sourceOk ? `${r.sourceStatus} OK` : `${r.sourceStatus || "ERR"} ⚠`;
        console.log(`[enrich-featured]   source:      ${event.sourceUrl.slice(0, 70)} → ${sourceLabel}`);

        if (r.imageFixed) {
          const via = r.imageSource === "websearch" ? "web search" : "og:image";
          console.log(`[enrich-featured]   image:       found via ${via} ✓`);
        } else if (r.unfeatured) {
          console.log(`[enrich-featured]   image:       no usable image found → un-featured ⚑`);
        } else if (event.imageUrl) {
          console.log(`[enrich-featured]   image:       ${event.imageUrl.slice(0, 70)} → OK`);
        } else {
          console.log(`[enrich-featured]   image:       null`);
        }

        const descLen = (event.description ?? "").length;
        if (r.descriptionEnriched) {
          console.log(`[enrich-featured]   description: ${descLen} chars → enriched via ${r.descriptionSource} ✓`);
        } else if (descLen < DESC_MIN_LENGTH) {
          console.log(`[enrich-featured]   description: ${descLen} chars → could not enrich`);
        } else {
          console.log(`[enrich-featured]   description: ${descLen} chars OK`);
        }

        if (r.titleMismatch) {
          console.log(`[enrich-featured]   title check: ⚠ page says "${r.titleMismatch.slice(0, 60)}"`);
        }

        return r;
      })
    );
    results.push(...chunkResults);
  }

  const brokenSources = results.filter((r) => !r.sourceOk).map((r) => ({ id: r.id, title: r.title, status: r.sourceStatus }));
  const titleMismatches = results
    .filter((r) => r.titleMismatch)
    .map((r) => ({ id: r.id, stored: r.title, page: r.titleMismatch! }));

  const imagesFromSearch = results.filter((r) => r.imageSource === "websearch").length;
  const unfeatured = results.filter((r) => r.unfeatured).map((r) => ({ id: r.id, title: r.title }));

  console.log(`\n[enrich-featured] === Summary ===`);
  console.log(`[enrich-featured]   Processed:           ${results.length}`);
  console.log(`[enrich-featured]   Images fixed:        ${results.filter((r) => r.imageFixed).length} (${imagesFromSearch} via web search)`);
  console.log(`[enrich-featured]   Un-featured:         ${unfeatured.length} (no usable image)`);
  console.log(`[enrich-featured]   Descriptions added:  ${results.filter((r) => r.descriptionEnriched).length}`);
  console.log(`[enrich-featured]   Broken sources:      ${brokenSources.length}`);
  console.log(`[enrich-featured]   Title mismatches:    ${titleMismatches.length}`);

  return {
    ok: true,
    processed: results.length,
    imagesFixed: results.filter((r) => r.imageFixed).length,
    imagesFromSearch,
    unfeatured: unfeatured.length,
    unfeaturedDetails: unfeatured,
    descriptionsAdded: results.filter((r) => r.descriptionEnriched).length,
    brokenSources: brokenSources.length,
    brokenSourceDetails: brokenSources,
    titleMismatches,
  };
}

export async function GET(req: NextRequest) {
  if (!(await checkCronOrAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runEnrichFeatured();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await checkCronOrAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runEnrichFeatured();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
