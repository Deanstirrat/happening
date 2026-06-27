/**
 * Shared event-description enrichment.
 *
 * One source of truth for: fetching a source page, pulling the best directly-
 * storable description out of its metadata (JSON-LD → og:description → meta
 * description), and — when that still comes up thin — generating a clean
 * description from the page body with Haiku.
 *
 * Consolidates logic that was previously forked across lib/scrapers/runner.ts
 * (og-only ingest backfill), scripts/enrich-featured.ts, and
 * scripts/populate-descriptions.ts. The page is already fetched at ingest for
 * the image backfill, so upgrading the extraction here is essentially free; the
 * AI step is the only added cost and callers scope when they pay it.
 */

import Anthropic from "@anthropic-ai/sdk";
import { decodeHtmlEntities } from "./decodeEntities";
import { anthropic as client } from "./anthropic";

// Stored descriptions can run long now — the in-app event view is meant to be a
// one-stop-shop, so users don't have to click through to the source.
export const DESCRIPTION_MAX_LENGTH = 1500;

// Below this, a description is "thin" — vague enough that we should try to do
// better (JSON-LD, a longer og:description, or an AI-written summary).
export const DESC_MIN_LENGTH = 120;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export interface PageMeta {
  ok: boolean;
  status: number;
  finalUrl: string | null;
  ogTitle: string | null;
  /** og:description, falling back to <meta name="description">. */
  ogDescription: string | null;
  ogImage: string | null;
  /** description pulled from an application/ld+json Event node, if present. */
  jsonLdDescription: string | null;
  /** Visible page text, scripts/styles/tags stripped, capped — AI context only. */
  bodyText: string;
}

// ── HTML extraction helpers ──────────────────────────────────────────────────

/** Read an og:<tag> meta property, trying both attribute orderings. */
function ogMeta(html: string, tag: string): string | null {
  const m =
    html.match(
      new RegExp(`<meta[^>]+property=["']og:${tag}["'][^>]+content=["']([^"']+)["']`, "i")
    ) ??
    html.match(
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${tag}["']`, "i")
    );
  return m?.[1] ? decodeHtmlEntities(m[1]) : null;
}

/** Read <meta name="description">, trying both attribute orderings. */
function nameDescriptionMeta(html: string): string | null {
  const m =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  return m?.[1] ? decodeHtmlEntities(m[1]) : null;
}

// Strip HTML tags and collapse whitespace — JSON-LD descriptions and body text
// frequently carry inline markup.
function stripHtml(s: string): string {
  return decodeHtmlEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Walk a parsed JSON-LD value for an Event-ish node's description. Pages embed
 * one object, an array, or an @graph wrapper; descriptions sometimes live on a
 * nested subEvent. We accept any node carrying a non-trivial string description,
 * preferring ones whose @type mentions "Event".
 */
function findJsonLdDescription(node: unknown, preferEvent = true): string | null {
  let fallback: string | null = null;

  const visit = (value: unknown): string | null => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const hit = visit(item);
        if (hit) return hit;
      }
      return null;
    }
    if (!value || typeof value !== "object") return null;
    const obj = value as Record<string, unknown>;

    if (Array.isArray(obj["@graph"])) {
      const hit = visit(obj["@graph"]);
      if (hit) return hit;
    }

    const desc = typeof obj.description === "string" ? stripHtml(obj.description) : "";
    if (desc.length >= 30) {
      const type = obj["@type"];
      const isEvent =
        typeof type === "string"
          ? /event/i.test(type)
          : Array.isArray(type) && type.some((t) => typeof t === "string" && /event/i.test(t));
      if (!preferEvent || isEvent) return desc;
      fallback ??= desc;
    }

    for (const key of ["subEvent", "mainEntity", "item"]) {
      if (obj[key]) {
        const hit = visit(obj[key]);
        if (hit) return hit;
      }
    }
    return null;
  };

  return visit(node) ?? fallback;
}

function extractJsonLdDescription(html: string): string | null {
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const block of blocks) {
    const raw = block[1]?.trim();
    if (!raw) continue;
    try {
      const hit = findJsonLdDescription(JSON.parse(raw));
      if (hit) return hit;
    } catch {
      // Malformed/partial JSON-LD — skip this block.
    }
  }
  return null;
}

function extractBodyText(html: string): string {
  return html
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
}

export function parseMeta(
  html: string
): Pick<PageMeta, "ogTitle" | "ogDescription" | "ogImage" | "jsonLdDescription" | "bodyText"> {
  return {
    ogTitle: ogMeta(html, "title"),
    ogDescription: ogMeta(html, "description") ?? nameDescriptionMeta(html),
    ogImage: ogMeta(html, "image"),
    jsonLdDescription: extractJsonLdDescription(html),
    bodyText: extractBodyText(html),
  };
}

export async function fetchPageMeta(url: string): Promise<PageMeta> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        finalUrl: res.url,
        ogTitle: null,
        ogDescription: null,
        ogImage: null,
        jsonLdDescription: null,
        bodyText: "",
      };
    }
    const html = await res.text();
    return { ok: true, status: res.status, finalUrl: res.url, ...parseMeta(html) };
  } catch {
    return {
      ok: false,
      status: 0,
      finalUrl: null,
      ogTitle: null,
      ogDescription: null,
      ogImage: null,
      jsonLdDescription: null,
      bodyText: "",
    };
  }
}

// ── Description selection ─────────────────────────────────────────────────────

/** Truncate at a word boundary with an ellipsis when over the limit. */
export function clampDescription(s: string, max = DESCRIPTION_MAX_LENGTH): string {
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

/**
 * Best directly-storable description from page metadata, no AI. Prefers the
 * longest substantive of the clean full-text sources (JSON-LD Event description,
 * then og/meta description). Never returns raw body text — that's noisy and is
 * reserved as context for the AI step. Returns undefined when nothing usable.
 */
export function pickStoredDescription(
  meta: Pick<PageMeta, "jsonLdDescription" | "ogDescription">
): string | undefined {
  const candidates = [meta.jsonLdDescription, meta.ogDescription]
    .map((c) => (c ? c.trim() : ""))
    .filter((c) => c.length > 0);
  if (candidates.length === 0) return undefined;
  // Longest wins — JSON-LD is usually the full event copy, but a richer
  // og:description should beat a one-line JSON-LD blurb.
  const best = candidates.sort((a, b) => b.length - a.length)[0];
  return clampDescription(best);
}

// ── AI description ────────────────────────────────────────────────────────────

/**
 * Write a clean, specific description from the source page's body text. Used as
 * the fallback when a page's metadata yields nothing substantive. Returns null
 * if no API key, on error, or if the model returns something too short to trust.
 */
export async function generateDescription(args: {
  title: string;
  venueName: string | null;
  startDate: Date;
  pageText: string;
}): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const { title, venueName, startDate, pageText } = args;
  try {
    const msg = await client.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 400,
        messages: [
          {
            role: "user",
            content: `Write an informative description for this San Francisco event so a reader can decide whether to go WITHOUT clicking through to another site. Aim for 3-5 sentences. Be specific: genre/format, vibe, who's performing or hosting, and what actually happens. Use only facts present in the page content below — do not invent details. No marketing fluff, no hype.

Event: ${title}
Venue: ${venueName ?? "unknown"}
Date: ${startDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}

Page content (for context):
${pageText.slice(0, 2400)}

Reply with only the description text. No quotes, no label prefix.`,
          },
        ],
      },
      // Bound the call so one slow generation can't stall a batch. The SDK
      // default is no request timeout + 2 retries, which under a stall means a
      // single event could hang for minutes; cap the request and allow one retry.
      { timeout: 20_000, maxRetries: 1 }
    );
    const text = ((msg.content[0] as Anthropic.TextBlock).text ?? "").trim();
    return text.length > 30 ? clampDescription(text) : null;
  } catch (e) {
    console.error(`    [ai-desc] error: ${(e as Error).message}`);
    return null;
  }
}
