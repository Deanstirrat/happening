import { put } from "@vercel/blob";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { parseDate } from "@/lib/createEvent";
import { sfDayStart } from "@/lib/sfDate";
import { extractEventFromImage, extractEventFromCaption } from "@/lib/extract";
import { INSTAGRAM_ACCOUNTS, type InstagramAccount } from "./instagram-accounts";
import { prisma } from "@/lib/prisma";
import { mapPool } from "@/lib/aiConcurrency";

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
 * Promoter/DJ accounts (tier: "promoter") run a cheap-first cascade: Claude
 * haiku on the caption first, escalating to Claude vision only when the caption
 * is missing a key field (no date OR no time) and an image exists — recovering
 * event times that are printed on the flyer graphic rather than the caption.
 *
 * Requires: APIFY_API_KEY environment variable.
 */

const LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000; // 2 days (scraper runs daily)
// Per-post extraction concurrency. Each post does a vision/caption Claude call
// plus an image download + Blob upload, so this also bounds concurrent image
// fetches — kept at 8 (not the global AI default) to stay polite to Instagram's
// CDN. The old 3-concurrent + 15s-inter-batch-delay throttle existed only to
// stay under the old 30k input-tok/min Claude limit, which the Scale tier lifts;
// the delay is gone. Override with INSTAGRAM_EXTRACT_CONCURRENCY.
const EXTRACT_CONCURRENCY = Math.max(
  1,
  Number(process.env.INSTAGRAM_EXTRACT_CONCURRENCY ?? "8")
);

// Retry budgets for the flaky Instagram CDN → Blob path. The CDN 429s/times out
// on repeat datacenter fetches, so a couple of retries recover most transient
// misses that used to permanently drop a flyer.
const IMAGE_FETCH_ATTEMPTS = 3;
const BLOB_PUT_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  // Present on video/reel posts — a guaranteed static JPEG thumbnail
  thumbnailSrc?: string | null;
  // Present on carousel posts — array of per-slide media objects
  sidecarItems?: Array<{ displayUrl?: string | null; thumbnailSrc?: string | null }> | null;
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

    // Run extraction over qualifying posts with bounded concurrency.
    const results = await mapPool(
      qualifying,
      (post) => {
        // Co-authored posts may have a different ownerUsername than the account
        // we queried. Fall back to a venue-tier placeholder so the post still
        // gets processed — Claude will extract the real venue name from the flyer.
        const known = accountMap.get(post.ownerUsername?.toLowerCase() ?? "");
        const account = known ?? {
          handle: post.ownerUsername ?? "unknown",
          venueName: post.ownerUsername ?? "Unknown Venue",
          tier: "venue" as const,
        };
        return this.processPost(post, account, Boolean(known));
      },
      { concurrency: EXTRACT_CONCURRENCY }
    );
    const events: ScrapedEvent[] = results.filter(
      (r): r is ScrapedEvent => r !== null
    );

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
    account: InstagramAccount,
    isKnownAccount: boolean
  ): Promise<ScrapedEvent | null> {
    const caption = post.caption ?? "";
    const { shortCode } = post;
    const sourceUrl = `https://www.instagram.com/p/${shortCode}/`;

    try {
      // Caption-first for every tier: run the cheap haiku pass on the caption,
      // then escalate to sonnet vision only when a key field (no date OR no
      // time) is missing and an image exists. The missing detail — most often
      // the start time — is frequently printed on the flyer graphic, invisible
      // to a caption-only read; but the image is the expensive path, so we only
      // reach for it when the caption alone can't carry the event.
      const imageUrl = this.bestImageUrl(post);
      let extracted = await extractEventFromCaption(caption);
      // The caption is the only source we trust to override a known venue's
      // home location (see resolveVenue). Capture its venue read now, before a
      // vision escalation can clobber `extracted` with the flyer's — where the
      // party name (e.g. "Throttle") routinely masquerades as the venue.
      const captionVenue = extracted.venueName;
      const missingKeyField = !extracted.dateRaw || !extracted.timeRaw;
      // Bytes fetched here for vision are reused for the Blob upload below, so
      // the same CDN image is never fetched twice. Instagram rate-limits repeat
      // datacenter fetches, and when vision runs it was the second fetch (the
      // Blob upload) that used to silently drop the flyer. Held as raw bytes +
      // MIME type: vision needs base64, Blob needs the buffer.
      let imageBytes: { body: Buffer; contentType: string } | null = null;
      if (missingKeyField && imageUrl) {
        imageBytes = await this.fetchImageBytes(imageUrl);
        if (imageBytes) {
          extracted = await extractEventFromImage(imageBytes.body.toString("base64"), imageBytes.contentType, caption);
        }
      }

      if (!extracted.title || !extracted.dateRaw) return null;

      let startDate = parseDate(extracted.dateRaw, extracted.timeRaw ?? undefined);
      if (!startDate) return null;

      // Noon-SF fallback for events without an explicit time — mirrors the
      // same pattern in lib/createEvent.ts to avoid UTC-midnight landing on
      // the wrong SF calendar day. Flag these as allDay so dedup knows the
      // time is a placeholder, not a real start time (see runner.ts).
      const noTimeProvided = !extracted.timeRaw?.trim();
      if (noTimeProvided) {
        const dateKey = startDate.toISOString().slice(0, 10); // YYYY-MM-DD
        const sfMidnight = sfDayStart(dateKey);
        startDate = new Date(sfMidnight.getTime() + 12 * 60 * 60 * 1000);
      }

      // Discard events that are already over (>1 day in the past).
      if (startDate.getTime() < Date.now() - 86_400_000) return null;

      // Persist the flyer to Blob. Reuse the bytes already fetched for vision
      // when we have them; otherwise download now (the caption carried every
      // field, so vision never ran). On Blob failure keep the raw CDN URL rather
      // than dropping the image — it still renders (briefly) via the image proxy
      // and, matching `cdninstagram.com`, stays visible to the backfill job that
      // re-hosts a permanent copy.
      let storedImageUrl: string | undefined;
      if (imageUrl) {
        const blobUrl = imageBytes
          ? await this.uploadBytesToBlob(imageBytes.body, imageBytes.contentType, shortCode)
          : await this.uploadImageToBlob(imageUrl, shortCode);
        storedImageUrl = blobUrl ?? imageUrl;
      }

      return {
        externalId: shortCode,
        title: extracted.title,
        description: extracted.description ?? undefined,
        startDate,
        allDay: noTimeProvided || undefined,
        venueName: this.resolveVenue(account, isKnownAccount, captionVenue, extracted.venueName),
        venueAddress: extracted.venueAddress ?? undefined,
        sourceUrl,
        imageUrl: storedImageUrl,
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
   * Resolve the venue for a post.
   *
   * A known venue-tier account IS a physical place — the posting handle maps
   * deterministically to its home venue (1015sf → "1015 Folsom"). That beats
   * anything vision reads off the flyer, which routinely surfaces the party or
   * promoter name ("Throttle") as if it were the venue. The lone exception is
   * an explicit caption mention of a *different* place (an off-site / pop-up
   * show), which we honor.
   *
   * Promoter-tier and unknown accounts have no fixed home venue — their
   * configured name is a promoter, not a place — so the extracted venue
   * (caption or flyer) wins, with that name only as a last-resort fallback.
   */
  private resolveVenue(
    account: InstagramAccount,
    isKnownAccount: boolean,
    captionVenue: string | null,
    extractedVenue: string | null
  ): string {
    if (isKnownAccount && account.tier === "venue") {
      const explicitlyElsewhere =
        !!captionVenue && !this.venuesMatch(captionVenue, account.venueName);
      return explicitlyElsewhere ? captionVenue : account.venueName;
    }
    return extractedVenue ?? account.venueName;
  }

  /**
   * Loose venue-name equality: case- and punctuation-insensitive, and
   * substring-aware so "1015" matches "1015 Folsom". Bias is toward calling
   * two names the same, which keeps the deterministic home venue rather than
   * treating a partial caption echo as an off-site move.
   */
  private venuesMatch(a: string, b: string): boolean {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const na = norm(a);
    const nb = norm(b);
    if (!na || !nb) return false;
    return na === nb || na.includes(nb) || nb.includes(na);
  }

  /**
   * Pick the best static image URL from a post. For video/reel posts Apify
   * sets `thumbnailSrc` to a guaranteed JPEG still; `displayUrl` on video posts
   * is sometimes a video CDN URL that browsers can't render as <img>. For
   * carousels we scan slides for the first image-backed URL.
   */
  private bestImageUrl(post: ApifyPost): string | null {
    // thumbnailSrc is a static JPEG thumbnail present on video/reel posts
    if (post.thumbnailSrc) return post.thumbnailSrc;
    // For carousels, pick the first slide that has a static image URL
    if (post.sidecarItems?.length) {
      for (const slide of post.sidecarItems) {
        const url = slide.thumbnailSrc ?? slide.displayUrl;
        if (url) return url;
      }
    }
    return post.displayUrl;
  }

  /**
   * Fetch an image URL and return its raw bytes + MIME type, retrying transient
   * failures (429 / 5xx / timeouts). Instagram's CDN rate-limits repeat fetches
   * from datacenter IPs, so a single miss shouldn't cost us the flyer. Returns
   * null for non-image content (e.g. video/mp4 for reels) or after retries fail.
   */
  private async fetchImageBytes(
    url: string
  ): Promise<{ body: Buffer; contentType: string } | null> {
    for (let attempt = 1; attempt <= IMAGE_FETCH_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; happening-sf/1.0)" },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          const retriable = res.status === 429 || res.status >= 500;
          if (retriable && attempt < IMAGE_FETCH_ATTEMPTS) {
            await sleep(attempt * 500);
            continue;
          }
          return null;
        }
        const contentType = (res.headers.get("content-type") ?? "image/jpeg")
          .split(";")[0]
          .trim();
        if (!contentType.startsWith("image/")) return null;
        return { body: Buffer.from(await res.arrayBuffer()), contentType };
      } catch (err) {
        if (attempt >= IMAGE_FETCH_ATTEMPTS) {
          console.warn(`[instagram] Image fetch failed after ${attempt} attempts:`, (err as Error).message);
          return null;
        }
        await sleep(attempt * 500);
      }
    }
    return null;
  }

  /**
   * Upload already-downloaded image bytes to Vercel Blob for permanent storage,
   * retrying transient put failures. Returns null if Blob is not configured or
   * all attempts fail.
   */
  private async uploadBytesToBlob(
    body: Buffer,
    contentType: string,
    shortCode: string
  ): Promise<string | null> {
    if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
    const ext = contentType.includes("webp") ? "webp" : contentType.includes("png") ? "png" : "jpg";
    for (let attempt = 1; attempt <= BLOB_PUT_ATTEMPTS; attempt++) {
      try {
        const blob = await put(`event-images/instagram-${shortCode}.${ext}`, body, {
          access: "public",
          contentType,
        });
        return blob.url;
      } catch (err) {
        if (attempt >= BLOB_PUT_ATTEMPTS) {
          console.warn(`[instagram] Failed to upload image for ${shortCode} to Blob:`, (err as Error).message);
          return null;
        }
        await sleep(attempt * 500);
      }
    }
    return null;
  }

  /**
   * Download an Instagram CDN image and upload it to Vercel Blob. Used on the
   * caption-only path where the flyer bytes weren't already fetched for vision.
   * Returns null if Blob is not configured, the download fails, or the URL
   * resolves to a non-image content type (e.g. video/mp4 for reels).
   */
  private async uploadImageToBlob(url: string, shortCode: string): Promise<string | null> {
    if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
    const fetched = await this.fetchImageBytes(url);
    if (!fetched) return null;
    return this.uploadBytesToBlob(fetched.body, fetched.contentType, shortCode);
  }
}
