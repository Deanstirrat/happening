import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../lib/prisma";

const CONCURRENCY = 3;
const DESC_MIN_LENGTH = 120;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

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

// Unwrap Next.js image proxy URLs and strip resize params so we store the real URL.
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
  if (!process.env.ANTHROPIC_API_KEY) return null;
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
  } catch (e) {
    console.error(`    [ai] error: ${(e as Error).message}`);
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
  startDate: Date;
  source: { slug: string };
}

interface EnrichResult {
  id: string;
  title: string;
  sourceOk: boolean;
  sourceStatus: number;
  imageFixed: boolean;
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
    descriptionEnriched: false,
    descriptionSource: null,
    titleMismatch: null,
  };

  // 1. Scrape source page (validation + content in one request)
  const meta = await fetchPageMeta(event.sourceUrl);
  result.sourceOk = meta.ok;
  result.sourceStatus = meta.status;

  // 2. Title mismatch check (advisory only — don't auto-update)
  if (meta.ogTitle && meta.ogTitle.toLowerCase() !== event.title.toLowerCase()) {
    const ogNorm = meta.ogTitle.replace(/\s+/g, " ").slice(0, 80);
    const evNorm = event.title.replace(/\s+/g, " ").slice(0, 80);
    if (!ogNorm.includes(evNorm) && !evNorm.includes(ogNorm)) {
      result.titleMismatch = meta.ogTitle;
    }
  }

  const updates: Partial<{ description: string; imageUrl: string | null }> = {};

  // 3. Image: validate existing → if broken, try og:image from scraped page
  let imageOk = false;
  if (event.imageUrl) {
    imageOk = await isImageAccessible(event.imageUrl);
    if (!imageOk) {
      // Existing image is broken — clear it and look for a replacement
      updates.imageUrl = null;
    }
  }

  if (!imageOk && meta.ogImage) {
    const candidate = resolveImageUrl(meta.ogImage);
    const candidateOk = await isImageAccessible(candidate);
    if (candidateOk) {
      updates.imageUrl = candidate;
      result.imageFixed = true;
    }
  }

  // 4. Description: enrich if missing or too short
  const existingDesc = event.description ?? "";
  const needsDesc = existingDesc.length < DESC_MIN_LENGTH;

  if (needsDesc) {
    // Try og:description first
    const ogDesc = meta.ogDescription;
    if (ogDesc && ogDesc.length >= DESC_MIN_LENGTH) {
      updates.description = ogDesc.slice(0, 500);
      result.descriptionEnriched = true;
      result.descriptionSource = "og";
    } else if (meta.ok && meta.bodyText.length > 100) {
      // Fall back to AI using page body content
      const aiDesc = await generateDescription(event.title, event.venueName, event.startDate, meta.bodyText);
      if (aiDesc) {
        updates.description = aiDesc;
        result.descriptionEnriched = true;
        result.descriptionSource = "ai";
      }
    }
  }

  // 5. Write changes
  if (Object.keys(updates).length > 0) {
    await prisma.event.update({ where: { id: event.id }, data: updates });
  }

  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const now = new Date();
  const events = await prisma.event.findMany({
    where: { featured: true, startDate: { gte: now }, status: "PUBLISHED" },
    select: {
      id: true,
      title: true,
      description: true,
      sourceUrl: true,
      imageUrl: true,
      venueName: true,
      startDate: true,
      source: { select: { slug: true } },
    },
    orderBy: { featuredAt: "desc" },
  });

  console.log(`\n=== Enriching ${events.length} featured event(s) ===\n`);

  if (events.length === 0) {
    console.log("No upcoming featured events found.");
    await prisma.$disconnect();
    return;
  }

  const results: EnrichResult[] = [];
  let i = 0;

  for (let batch = 0; batch < events.length; batch += CONCURRENCY) {
    const chunk = events.slice(batch, batch + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (event) => {
        i++;
        console.log(`[${i}/${events.length}] ${event.title}`);
        const r = await enrichEvent(event);

        const sourceLabel = r.sourceOk ? `${r.sourceStatus} OK` : `${r.sourceStatus || "ERR"} ⚠`;
        console.log(`  source:      ${event.sourceUrl.slice(0, 70)} → ${sourceLabel}`);

        if (event.imageUrl) {
          console.log(`  image:       ${event.imageUrl.slice(0, 70)} → ${r.imageFixed ? "replaced" : "OK"}`);
        } else if (r.imageFixed) {
          console.log(`  image:       null → found og:image ✓`);
        } else {
          console.log(`  image:       null (no og:image found)`);
        }

        const descLen = (event.description ?? "").length;
        if (r.descriptionEnriched) {
          console.log(`  description: ${descLen} chars → enriched via ${r.descriptionSource} ✓`);
        } else if (descLen < DESC_MIN_LENGTH) {
          console.log(`  description: ${descLen} chars → could not enrich`);
        } else {
          console.log(`  description: ${descLen} chars OK`);
        }

        if (r.titleMismatch) {
          console.log(`  title check: ⚠ page says "${r.titleMismatch.slice(0, 60)}"`);
        }

        console.log();
        return r;
      })
    );
    results.push(...chunkResults);
  }

  // Summary
  const brokenSources = results.filter((r) => !r.sourceOk).length;
  const imagesFixed = results.filter((r) => r.imageFixed).length;
  const descsEnriched = results.filter((r) => r.descriptionEnriched).length;
  const titleMismatches = results.filter((r) => r.titleMismatch).length;

  console.log("=== Summary ===");
  console.log(`  Events processed:    ${results.length}`);
  console.log(`  Broken source URLs:  ${brokenSources}`);
  console.log(`  Images fixed:        ${imagesFixed}`);
  console.log(`  Descriptions added:  ${descsEnriched}`);
  console.log(`  Title mismatches:    ${titleMismatches} (review manually)`);

  if (brokenSources > 0) {
    console.log("\n  Broken sources:");
    results.filter((r) => !r.sourceOk).forEach((r) => {
      console.log(`    [${r.sourceStatus || "ERR"}] ${r.title}`);
    });
  }
  if (titleMismatches > 0) {
    console.log("\n  Title mismatches (page title vs stored title):");
    results.filter((r) => r.titleMismatch).forEach((r) => {
      console.log(`    stored: "${r.title}"`);
      console.log(`    page:   "${r.titleMismatch}"`);
    });
  }

  await prisma.$disconnect();
}

main().catch(console.error);
