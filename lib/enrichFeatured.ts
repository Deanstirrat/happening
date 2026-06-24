/**
 * Shared per-event enrichment for *featured* events.
 *
 * One source of truth for the featured-event polish pass: clean up the title,
 * resolve a usable image (existing → og:image → web search → category/venue
 * placeholder), and fill a thin description. A featured event is NEVER dropped
 * from the rail for lack of an image (#191): when no real image resolves we
 * fall back to a tasteful placeholder and keep it featured. Both the nightly
 * Railway cron
 * (scripts/enrich-featured.ts) and the admin-triggered API route
 * (app/api/admin/curation/enrich-featured/route.ts) call enrichEvent() here, so
 * the two paths can't drift.
 *
 * Description extraction/generation lives in lib/enrichDescription.ts (shared
 * further with the ingest backfill and the pre-feature candidate job); this
 * module adds the featured-only image cascade and AI title cleanup on top.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { EventCategory } from "@prisma/client";
import { prisma } from "./prisma";
import { decodeHtmlEntities } from "./decodeEntities";
import { resolveFallbackImage } from "./eventImage";
import {
  fetchPageMeta,
  pickStoredDescription,
  generateDescription,
  DESC_MIN_LENGTH,
} from "./enrichDescription";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// ─── Title comparison helpers ───────────────────────────────────────────────

// Canonical form for comparing/deciding whether a title actually changed.
// Ignores entity encoding, smart vs. straight quotes, dash style, and whitespace,
// but preserves wording and capitalization so genuine cleanups still get written.
function canonicalTitle(s: string): string {
  return decodeHtmlEntities(s)
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

// Case-insensitive key for detecting a genuine event-identity mismatch.
const compareKey = (s: string) => canonicalTitle(s).toLowerCase();

// ─── Image validation ───────────────────────────────────────────────────────

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
// not a real per-event image. Real scraped images are always absolute http(s) URLs,
// so we treat any non-absolute imageUrl as "needs a real image".
function isDefaultImage(url: string | null): boolean {
  return !!url && !/^https?:\/\//i.test(url);
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

// ─── AI title cleanup ─────────────────────────────────────────────────────────

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

// ─── AI featured blurb ────────────────────────────────────────────────────────

// Tells that out a blurb as machine-written. The big one is the "…, but actually
// …" / "and actually …" twist — a setup-then-correction cadence that reads as
// backhanded and showed up across a suspicious number of blurbs. Also catches the
// related contrarian comparison tic ("beats any …", "more than your average …").
// Used both as a post-generation reject and as a regenerate trigger so existing
// blurbs that carry the tell get rewritten on the next enrichment pass.
const AI_TELL_PATTERNS: RegExp[] = [
  /\bactually\b/i,
  /\b(beats|better than|more than your average|unlike most)\b/i,
];
function blurbHasAiTell(text: string): boolean {
  return AI_TELL_PATTERNS.some((re) => re.test(text));
}

// A one-line "why this is worth your time" hook for a featured event, shown on
// the featured card and in a highlighted block on the detail page. The prompt is
// deliberately strict about voice: short, concrete, and stripped of the
// breathless marketing/AI clichés that make a blurb read as filler. Returns null
// on failure or if the model can't say anything specific — the caller keeps any
// existing blurb rather than overwriting a good line with a worse one.
async function generateFeaturedBlurb(args: {
  title: string;
  description: string | null;
  venueName: string | null;
  category: EventCategory | null;
  startDate: Date;
}): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const { title, description, venueName, category, startDate } = args;
  const dateStr = startDate.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 90,
      temperature: 0.7, // a little range so blurbs don't all read identically
      messages: [
        {
          role: "user",
          content: `Write ONE short sentence (max 18 words) telling a San Francisco local why this event is worth going to. It sits on a "featured" card, so it has to earn the pick — name the specific thing that makes it good (the artist, the format, the room, the one-off occasion), not a vague mood.

Hard rules:
- Sound like a sharp friend with good taste texting you, not a brochure and not an AI.
- State the appeal straight. Do NOT use the "X, but actually Y" / "and actually Z" setup-then-twist — it reads as backhanded and is a dead AI giveaway. The word "actually" is banned.
- Don't sell it by putting other things down. No backhanded comparisons ("beats any indoor venue", "better than your average DJ night", "unlike most warehouse parties"). Just say what's good about THIS one.
- No hype clichés. BANNED words/phrases: "actually", "don't miss", "must-see", "must-attend", "immerse", "vibrant", "unforgettable", "experience the magic", "vibes", "perfect for", "whether you're", "something for everyone", "dive into", "elevate", "curated", "a celebration of", "join us", "nestled", "boasts", "lineup of".
- No exclamation marks, no emoji, no Title Case. Don't just restate the event title.
- Be concrete. If you lack a specific reason, lead with the single most interesting real detail.

Event: ${title}
Venue: ${venueName ?? "unknown"}
Date: ${dateStr}
Category: ${category ?? "n/a"}
${description ? `Details: ${description.slice(0, 500)}` : ""}

Reply with ONLY the sentence — no quotes, no label.`,
        },
      ],
    });
    let text = ((msg.content[0] as Anthropic.TextBlock).text ?? "").trim();
    text = text.replace(/^["'“”]+|["'“”]+$/g, "").trim(); // strip wrapping quotes
    // Reject empties, multi-line answers (not a one-liner), or runaway length.
    if (!text || text.length < 15 || text.length > 180 || /[\r\n]/.test(text)) return null;
    // Reject the AI tells (the "actually" twist, backhanded comparisons) even when
    // the model slips past the prompt — better no blurb than an obvious one; the
    // next run retries with fresh sampling.
    if (blurbHasAiTell(text)) return null;
    return text;
  } catch (e) {
    console.error(`    [ai-blurb] error: ${(e as Error).message}`);
    return null;
  }
}

// ─── Web image search ───────────────────────────────────────────────────────

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
  if (!process.env.ANTHROPIC_API_KEY) return null;
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
  } catch (e) {
    console.error(`    [ai-image] error: ${(e as Error).message}`);
    return null;
  }
}

// ─── Per-event enrichment ─────────────────────────────────────────────────────

export interface EnrichEventRow {
  id: string;
  title: string;
  description: string | null;
  sourceUrl: string;
  imageUrl: string | null;
  venueName: string | null;
  city: string;
  startDate: Date;
  // For the placeholder fallback when no real image resolves (see step 3c).
  category: EventCategory | null;
  sourceSlug: string;
  // Existing blurb (if any) so we only generate one when it's missing.
  featuredBlurb: string | null;
}

export interface EnrichResult {
  id: string;
  title: string;
  sourceOk: boolean;
  sourceStatus: number;
  imageFixed: boolean;
  imageSource: "og" | "websearch" | null;
  // True when the image cascade found nothing real and the event is now relying
  // on a category/venue placeholder (or a UI gradient). It stays featured — this
  // flags the gap for the run summary, it does NOT mean the event was dropped.
  usedFallbackImage: boolean;
  descriptionEnriched: boolean;
  descriptionSource: "og" | "ai" | null;
  // True when a "why we featured it" blurb was generated this run (it was
  // previously missing). Existing blurbs are left untouched.
  blurbAdded: boolean;
  titleRenamed: string | null;
  titleMismatch: string | null;
}

export async function enrichEvent(event: EnrichEventRow): Promise<EnrichResult> {
  const result: EnrichResult = {
    id: event.id,
    title: event.title,
    sourceOk: true,
    sourceStatus: 200,
    imageFixed: false,
    imageSource: null,
    usedFallbackImage: false,
    descriptionEnriched: false,
    descriptionSource: null,
    blurbAdded: false,
    titleRenamed: null,
    titleMismatch: null,
  };

  // 1. Scrape source page (validation + content in one request)
  const meta = await fetchPageMeta(event.sourceUrl);
  result.sourceOk = meta.ok;
  result.sourceStatus = meta.status;

  const updates: Partial<{
    description: string;
    imageUrl: string | null;
    title: string;
    featuredBlurb: string;
  }> = {};

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

  // 3. Image cascade: keep a usable real image → og:image → web search → placeholder.
  //    A `/`-rooted default (e.g. sfrecpark placeholder) counts as "no real image".
  let haveUsableImage = false;
  if (event.imageUrl && !isDefaultImage(event.imageUrl)) {
    haveUsableImage = await isImageAccessible(event.imageUrl);
    if (!haveUsableImage) {
      // Existing real image is broken — clear it and look for a replacement.
      updates.imageUrl = null;
    }
  }

  // 3a. og:image from the event's own source page.
  if (!haveUsableImage && meta.ogImage) {
    const candidate = resolveImageUrl(meta.ogImage);
    if (await isImageAccessible(candidate)) {
      updates.imageUrl = candidate;
      haveUsableImage = true;
      result.imageFixed = true;
      result.imageSource = "og";
    }
  }

  // 3b. Web search: find the event's real listing page elsewhere → its og:image.
  if (!haveUsableImage) {
    const found = await findImageViaWebSearch(event);
    if (found) {
      updates.imageUrl = found;
      haveUsableImage = true;
      result.imageFixed = true;
      result.imageSource = "websearch";
    }
  }

  // 3c. Still nothing real → keep the event featured and fall back to a
  //     category/venue placeholder so the rail always renders something (#191).
  //     A featured event is never un-featured just for missing an image — the
  //     curator's underground/Instagram-sourced picks are exactly the ones that
  //     fail the image cascade, and dropping them defeats the point.
  if (!haveUsableImage) {
    const fallback = resolveFallbackImage({
      venueName: event.venueName,
      sourceSlug: event.sourceSlug,
      category: event.category,
    });
    // Write the placeholder only if it improves on what's stored; a null
    // fallback (no venue photo, no category tile) leaves imageUrl as-is and the
    // UI renders a gradient. Either way the event stays featured.
    if (fallback && fallback !== event.imageUrl) {
      updates.imageUrl = fallback;
    }
    result.usedFallbackImage = true;
  }

  // 4. Description: enrich if missing or too short
  const existingDesc = event.description ?? "";
  const needsDesc = existingDesc.length < DESC_MIN_LENGTH;

  if (needsDesc) {
    // Free metadata first (JSON-LD Event copy → og: → meta description).
    const metaDesc = pickStoredDescription(meta);
    if (metaDesc && metaDesc.length >= DESC_MIN_LENGTH) {
      updates.description = metaDesc;
      result.descriptionEnriched = true;
      result.descriptionSource = "og";
    } else if (meta.ok && meta.bodyText.length > 100) {
      // Fall back to AI using page body content
      const aiDesc = await generateDescription({
        title: event.title,
        venueName: event.venueName,
        startDate: event.startDate,
        pageText: meta.bodyText,
      });
      if (aiDesc) {
        updates.description = aiDesc;
        result.descriptionEnriched = true;
        result.descriptionSource = "ai";
      }
    }
  }

  // 4b. Featured blurb: a one-line "why we picked it" hook. Normally generated
  //     once and kept stable across nightly runs (fill only when missing) so the
  //     card copy doesn't churn — but we also rewrite a blurb that carries an AI
  //     tell (the "actually" twist, backhanded comparisons) so bad ones self-heal
  //     on the next pass. Uses the freshest title/description from this pass.
  const existingBlurb = event.featuredBlurb?.trim() ?? "";
  if (!existingBlurb || blurbHasAiTell(existingBlurb)) {
    const blurb = await generateFeaturedBlurb({
      title: updates.title ?? event.title,
      description: updates.description ?? event.description,
      venueName: event.venueName,
      category: event.category,
      startDate: event.startDate,
    });
    if (blurb) {
      updates.featuredBlurb = blurb;
      result.blurbAdded = true;
    }
  }

  // 5. Write changes
  if (Object.keys(updates).length > 0) {
    await prisma.event.update({ where: { id: event.id }, data: updates });
  }

  return result;
}
