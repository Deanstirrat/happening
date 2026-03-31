import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { parseDate } from "@/lib/createEvent";
import { sfDayStart } from "@/lib/sfDate";
import { extractEventFromImage, extractEventFromCaption } from "@/lib/extract";
import { INSTAGRAM_ACCOUNTS, type InstagramAccount } from "./instagram-accounts";
import { prisma } from "@/lib/prisma";

/**
 * Instagram venue scraper for SF events.
 *
 * Uses Apify's Instagram Post Scraper to fetch recent posts from curated SF
 * venue and promoter accounts. All accounts are batched into a single Apify
 * request (one for venues, one for promoters) to keep scrape time flat
 * regardless of account count.
 *
 * Venue accounts (tier: "venue") use Claude vision on the post image — event
 * flyers carry most of their info visually.
 * Promoter/DJ accounts (tier: "promoter") use Claude haiku on the caption
 * text only — cheaper and sufficient for caption-first posts.
 *
 * Requires: APIFY_API_KEY environment variable.
 */

const LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000; // 2 days (scraper runs daily)
// Vision calls use ~1,600 input tokens per image. At concurrency 3 with a 15s
// inter-batch delay we stay well under Claude's 30k input-token/min rate limit.
const EXTRACT_CONCURRENCY = 3;
const EXTRACT_DELAY_MS = 15_000;

// Minimum number of heuristic signals a caption must hit to be worth sending to Claude.
const MIN_EVENT_SIGNALS = 2;
// Full month names AND 3-letter abbreviations (the \b after short abbreviations only works
// if the abbreviation is a standalone word, e.g. "Mar 29" but NOT "March 29" — so we must
// list full names explicitly).
const DATE_RE =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec|\d{1,2}\/\d{1,2})\b/i;
// Full and abbreviated day names; "tmrw" and "weekend" are common in Instagram captions.
const DAY_RE =
  /\b(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tonight|tomorrow|tmrw|weekend)\b/i;
const TIME_RE = /\b\d{1,2}(:\d{2})?\s*(am|pm|doors?)\b/i;
const EVENT_RE = /\b(present|presents|featuring|feat\.|live|doors?|show|ticket|tix|rsvp|lineup)\b/i;

interface ApifyPost {
  shortCode: string;
  caption: string | null;
  displayUrl: string | null;
  timestamp: string; // ISO 8601
  ownerUsername: string;
}

export class InstagramScraper extends BaseScraper {
  readonly sourceSlug = "instagram";

  async scrape(): Promise<ScrapedEvent[]> {
    if (!process.env.APIFY_API_KEY) {
      console.warn("[instagram] APIFY_API_KEY not set — skipping");
      return [];
    }

    const venues = INSTAGRAM_ACCOUNTS.filter((a) => a.tier === "venue");
    const promoters = INSTAGRAM_ACCOUNTS.filter((a) => a.tier === "promoter");

    // Build a lookup map: lowercase handle → account config
    const accountMap = new Map<string, InstagramAccount>(
      INSTAGRAM_ACCOUNTS.map((a) => [a.handle.toLowerCase(), a])
    );

    // Two batched Apify calls: venues get more posts (flyers, less frequent),
    // promoters get fewer (high-volume accounts, lower per-post signal).
    const [venuePosts, promoterPosts] = await Promise.all([
      venues.length > 0
        ? this.fetchPosts(venues.map((a) => a.handle), 10)
        : Promise.resolve([]),
      promoters.length > 0
        ? this.fetchPosts(promoters.map((a) => a.handle), 5)
        : Promise.resolve([]),
    ]);

    const allPosts = [...venuePosts, ...promoterPosts];
    const now = Date.now();

    // Pre-fetch shortCodes we've already processed (either became events or were
    // tried and rejected). This prevents re-sending the same post to Claude on
    // every daily run within the lookback window.
    const [existingRows, seenRows] = await Promise.all([
      prisma.event.findMany({
        where: { source: { slug: "instagram" }, externalId: { not: null } },
        select: { externalId: true },
      }),
      prisma.instagramSeenPost.findMany({ select: { shortCode: true } }),
    ]);
    const seenShortCodes = new Set([
      ...existingRows.map((r) => r.externalId as string),
      ...seenRows.map((r) => r.shortCode),
    ]);

    const qualifying = allPosts.filter((post) => {
      if (now - new Date(post.timestamp).getTime() > LOOKBACK_MS) return false;
      if (seenShortCodes.has(post.shortCode)) return false;
      // Venue posts with a flyer image: lower the bar to 1 signal.
      // Event details live in the image, not the caption.
      // Unknown accounts fall back to venue tier (matches processPost behavior).
      const account = accountMap.get(post.ownerUsername?.toLowerCase() ?? "");
      const isVenueWithImage =
        account?.tier !== "promoter" && !!post.displayUrl;
      const threshold = isVenueWithImage ? 1 : MIN_EVENT_SIGNALS;
      return this.looksLikeEvent(post.caption ?? "", threshold);
    });

    console.log(
      `[instagram] ${allPosts.length} posts fetched, ${seenShortCodes.size} already in DB, ${qualifying.length} new and pass heuristic filter`
    );

    // Process in batches of EXTRACT_CONCURRENCY with a delay between batches
    // to stay under Claude's 30k input-token/min rate limit for vision calls.
    const events: ScrapedEvent[] = [];
    for (let i = 0; i < qualifying.length; i += EXTRACT_CONCURRENCY) {
      const batch = qualifying.slice(i, i + EXTRACT_CONCURRENCY);
      const results = await Promise.all(
        batch.map((post) => {
          // Co-authored posts may have a different ownerUsername than the account
          // we queried. Fall back to a venue-tier placeholder so the post still
          // gets processed — Claude will extract the real venue name from the flyer.
          const account = accountMap.get(post.ownerUsername?.toLowerCase() ?? "") ?? {
            handle: post.ownerUsername ?? "unknown",
            venueName: post.ownerUsername ?? "Unknown Venue",
            tier: "venue" as const,
          };
          return this.processPost(post, account);
        })
      );
      for (const r of results) {
        if (r) events.push(r);
      }
      if (i + EXTRACT_CONCURRENCY < qualifying.length) {
        await new Promise((r) => setTimeout(r, EXTRACT_DELAY_MS));
      }
    }

    // Mark all qualifying posts as seen so they're never re-sent to Claude,
    // regardless of whether they became events or not.
    if (qualifying.length > 0) {
      await prisma.instagramSeenPost.createMany({
        data: qualifying.map((p) => ({ shortCode: p.shortCode })),
        skipDuplicates: true,
      });
    }

    console.log(`[instagram] ${events.length} events extracted`);
    return events;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Fetch posts from a list of Instagram handles via Apify's run-sync endpoint.
   * Blocks until the Actor finishes (up to 300s) and returns items directly.
   */
  private async fetchPosts(handles: string[], resultsLimit: number): Promise<ApifyPost[]> {
    const url =
      `https://api.apify.com/v2/acts/apify~instagram-post-scraper` +
      `/run-sync-get-dataset-items?token=${process.env.APIFY_API_KEY}&timeout=1800`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: handles,
          resultsLimit,
          dataDetailLevel: "basicData",
          onlyPostsNewerThan: "2 days",
        }),
        signal: AbortSignal.timeout(1_830_000), // slightly longer than Apify's own timeout
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error(`[instagram] Apify responded ${res.status}: ${text.slice(0, 300)}`);
        return [];
      }

      const data = (await res.json()) as unknown;
      if (!Array.isArray(data)) {
        console.error("[instagram] Unexpected Apify response shape:", typeof data);
        return [];
      }

      return data as ApifyPost[];
    } catch (err) {
      console.error("[instagram] Apify fetch failed:", (err as Error).message);
      return [];
    }
  }

  /**
   * Returns true if the caption contains at least MIN_EVENT_SIGNALS heuristic
   * signals that it is announcing an event (not a food photo, travel shot, etc.).
   */
  private looksLikeEvent(caption: string, minSignals = MIN_EVENT_SIGNALS): boolean {
    const signals = [DATE_RE, DAY_RE, TIME_RE, EVENT_RE];
    const count = signals.filter((re) => re.test(caption)).length;
    return count >= minSignals;
  }

  /**
   * Run Claude extraction on a single post and return a ScrapedEvent, or null
   * if extraction fails or no parseable date is found.
   */
  private async processPost(
    post: ApifyPost,
    account: InstagramAccount
  ): Promise<ScrapedEvent | null> {
    const caption = post.caption ?? "";
    const { shortCode } = post;
    const sourceUrl = `https://www.instagram.com/p/${shortCode}/`;

    try {
      // Venue tier → prefer vision; fall back to caption if image unavailable.
      // Promoter tier → caption only (cheaper, sufficient for text-first posts).
      let extracted;
      if (account.tier === "venue" && post.displayUrl) {
        const img = await this.fetchImageAsBase64(post.displayUrl);
        extracted = img
          ? await extractEventFromImage(img.base64, img.mediaType, caption)
          : await extractEventFromCaption(caption);
      } else {
        extracted = await extractEventFromCaption(caption);
      }

      if (!extracted.title || !extracted.dateRaw) return null;

      let startDate = parseDate(extracted.dateRaw, extracted.timeRaw ?? undefined);
      if (!startDate) return null;

      // Noon-SF fallback for events without an explicit time — mirrors the
      // same pattern in lib/createEvent.ts to avoid UTC-midnight landing on
      // the wrong SF calendar day.
      if (!extracted.timeRaw?.trim()) {
        const dateKey = startDate.toISOString().slice(0, 10); // YYYY-MM-DD
        const sfMidnight = sfDayStart(dateKey);
        startDate = new Date(sfMidnight.getTime() + 12 * 60 * 60 * 1000);
      }

      // Discard events that are already over (>1 day in the past).
      if (startDate.getTime() < Date.now() - 86_400_000) return null;

      return {
        externalId: shortCode,
        title: extracted.title,
        description: extracted.description ?? undefined,
        startDate,
        venueName: extracted.venueName ?? account.venueName,
        venueAddress: extracted.venueAddress ?? undefined,
        sourceUrl,
        imageUrl: post.displayUrl ?? undefined,
        price: extracted.price ?? undefined,
        isFree: extracted.isFree || this.parseFree(extracted.price ?? undefined),
        tags: [...(extracted.tags ?? []), "instagram"],
      };
    } catch (err) {
      console.error(`[instagram] Failed to process post ${shortCode}:`, (err as Error).message);
      return null;
    }
  }

  /**
   * Download an image URL and return it base64-encoded with its MIME type,
   * suitable for passing directly to extractEventFromImage().
   */
  private async fetchImageAsBase64(
    url: string
  ): Promise<{ base64: string; mediaType: string } | null> {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; happening-sf/1.0)" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      const contentType = res.headers.get("content-type") ?? "image/jpeg";
      const mediaType = contentType.split(";")[0].trim();
      const buffer = await res.arrayBuffer();
      return { base64: Buffer.from(buffer).toString("base64"), mediaType };
    } catch {
      return null;
    }
  }
}
