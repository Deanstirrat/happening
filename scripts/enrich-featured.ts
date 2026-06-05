import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../lib/prisma";

const CONCURRENCY = 3;
const DESC_MIN_LENGTH = 120;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// ─── Text / title helpers ──────────────────────────────────────────────────────

// Decode HTML entities (named + numeric + hex). Runs twice to unwrap
// double-encoded sequences like "&amp;#039;" → "&#039;" → "'".
function decodeEntities(input: string): string {
  let s = input;
  for (let pass = 0; pass < 2; pass++) {
    s = s
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&mdash;/gi, "—")
      .replace(/&ndash;/gi, "–")
      .replace(/&hellip;/gi, "…")
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&"); // last, so a second pass can decode unwrapped numeric entities
  }
  return s.replace(/\s+/g, " ").trim();
}

// Canonical form for comparing/deciding whether a title actually changed.
// Ignores entity encoding, smart vs. straight quotes, dash style, and whitespace,
// but preserves wording and capitalization so genuine cleanups still get written.
function canonicalTitle(s: string): string {
  return decodeEntities(s)
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

// Case-insensitive key for detecting a genuine event-identity mismatch.
const compareKey = (s: string) => canonicalTitle(s).toLowerCase();

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
    return m?.[1] ? decodeEntities(m[1]) : null;
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
    ogDescription: attr("description", "property") ?? (plainTitle ? decodeEntities(plainTitle) : null),
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

// ─── AI title cleanup ──────────────────────────────────────────────────────────

// Produce a cleaner, more concise title. Conservative: preserves the event's
// identity and only fixes wording/length/formatting. Returns null on failure or
// if the model declines to improve it (caller compares against the original).
async function generateCleanTitle(
  currentTitle: string,
  ogTitle: string | null,
  venueName: string | null,
  pageText: string
): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 60,
      temperature: 0, // deterministic → stable across runs, no title churn
      messages: [
        {
          role: "user",
          content: `You clean up event titles for a San Francisco events listing. Return the clearest, most concise title for this event.

Guidelines:
- Keep it short and scannable — aim for under 60 characters.
- Lead with the core identity: the artist, DJ, party, or event name.
- Remove website/brand suffixes (e.g. "| Eventbrite", "— Ruth's Table"), redundant location tags like "(SF)", trailing year/date parentheticals like "(June 2026)", and marketing filler.
- Strip verbose date/time tails (e.g. ", June 5th, from 9pm").
- Fix capitalization, spacing, and punctuation. Use straight quotes (').
- PRESERVE the event's identity and its essential qualifier. Do NOT invent details, do NOT change which event this is, and do NOT add information that isn't already implied by the current title.
- If the current title is already clean and concise, return it unchanged.

Current title: ${currentTitle}
Page title (hint only — may include site name or noise): ${ogTitle ?? "n/a"}
Venue: ${venueName ?? "unknown"}
Page content (context only):
${pageText.slice(0, 600)}

Reply with ONLY the final title text — no quotes, no labels, no explanation.`,
        },
      ],
    });
    let text = ((msg.content[0] as Anthropic.TextBlock).text ?? "").trim();
    text = text.replace(/^["'“”]+|["'“”]+$/g, "").trim(); // strip wrapping quotes the model may add
    // Reject obvious garbage: empty, multi-line (not a title), or runaway length.
    if (!text || text.length < 3 || text.length > 90 || /[\r\n]/.test(text)) return null;
    return text;
  } catch (e) {
    console.error(`    [ai-title] error: ${(e as Error).message}`);
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
  titleRenamed: string | null;
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
    titleRenamed: null,
    titleMismatch: null,
  };

  // 1. Scrape source page (validation + content in one request)
  const meta = await fetchPageMeta(event.sourceUrl);
  result.sourceOk = meta.ok;
  result.sourceStatus = meta.status;

  const updates: Partial<{ description: string; imageUrl: string | null; title: string }> = {};

  // 2. Title: clean up wording/length/formatting via AI (preserves identity).
  //    Runs even when the source is blocked — a wordy title can be fixed without the page.
  const cleanTitle = await generateCleanTitle(event.title, meta.ogTitle, event.venueName, meta.bodyText);
  if (cleanTitle && canonicalTitle(cleanTitle) !== canonicalTitle(event.title)) {
    updates.title = cleanTitle;
    result.titleRenamed = cleanTitle;
  }

  // 2b. Advisory mismatch: only when we did NOT rename and the page describes a
  //     genuinely different event (after decoding/normalizing — no more entity
  //     false positives). Identity changes stay manual; we don't auto-adopt these.
  if (!result.titleRenamed && meta.ogTitle) {
    const og = compareKey(meta.ogTitle);
    const ev = compareKey(event.title);
    if (og !== ev && !og.includes(ev) && !ev.includes(og)) {
      result.titleMismatch = meta.ogTitle;
    }
  }

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

        if (r.titleRenamed) {
          console.log(`  title:       "${event.title.slice(0, 55)}"`);
          console.log(`               → "${r.titleRenamed.slice(0, 55)}" ✓`);
        } else if (r.titleMismatch) {
          console.log(`  title check: ⚠ page says "${r.titleMismatch.slice(0, 60)}" (review manually)`);
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
  const titlesRenamed = results.filter((r) => r.titleRenamed).length;
  const titleMismatches = results.filter((r) => r.titleMismatch).length;

  console.log("=== Summary ===");
  console.log(`  Events processed:    ${results.length}`);
  console.log(`  Broken source URLs:  ${brokenSources}`);
  console.log(`  Images fixed:        ${imagesFixed}`);
  console.log(`  Descriptions added:  ${descsEnriched}`);
  console.log(`  Titles renamed:      ${titlesRenamed}`);
  console.log(`  Title mismatches:    ${titleMismatches} (review manually)`);

  if (titlesRenamed > 0) {
    console.log("\n  Titles renamed:");
    results.filter((r) => r.titleRenamed).forEach((r) => {
      console.log(`    "${r.title}"`);
      console.log(`      → "${r.titleRenamed}"`);
    });
  }

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
