import axios from "axios";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

/**
 * KQED Live Events — kqed.org/events
 *
 * KQED renders their events page with React/Redux and embeds all event data
 * in a `window.__INITIAL_STATE__` JSON blob for hydration. Each event lives
 * in `postsReducer` under a key like `events_5957` and contains:
 *   - title, startTime (unix seconds), endTime, venueName, eventPrice, featImg
 * Images are cross-referenced in `attachmentsReducer` by featImg key.
 *
 * The "More Events" button on the listing page triggers client-side loading
 * rather than URL-based pagination, so this scraper only captures the initial
 * set of events embedded in the page (typically ~10–20 upcoming events).
 */
export class KqedScraper extends BaseScraper {
  readonly sourceSlug = "kqed";
  private readonly LISTING_URL = "https://www.kqed.org/events";
  private readonly EVENT_BASE_URL = "https://www.kqed.org/event";

  async scrape(): Promise<ScrapedEvent[]> {
    let html: string;
    try {
      const { data } = await axios.get(this.LISTING_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        timeout: 20000,
      });
      html = data;
    } catch (err: any) {
      console.error("[kqed] Fetch error:", err.message);
      return [];
    }

    // Extract window.__INITIAL_STATE__ JSON blob using bracket counting.
    // The blob is ~200KB and has no trailing semicolon, so regex approaches
    // are both incorrect and slow; bracket counting is O(n) and exact.
    const assignIdx = html.indexOf("window.__INITIAL_STATE__=");
    if (assignIdx === -1) {
      console.error("[kqed] Could not find window.__INITIAL_STATE__");
      return [];
    }
    const jsonStart = html.indexOf("{", assignIdx);
    if (jsonStart === -1) {
      console.error("[kqed] Could not find JSON start after __INITIAL_STATE__");
      return [];
    }

    let depth = 0;
    let inStr = false;
    let esc = false;
    let jsonEnd = -1;
    for (let i = jsonStart; i < html.length; i++) {
      const c = html[i];
      if (esc) { esc = false; continue; }
      if (c === "\\" && inStr) { esc = true; continue; }
      if (c === '"' && !esc) { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === "{") depth++;
      if (c === "}") { depth--; if (depth === 0) { jsonEnd = i; break; } }
    }

    if (jsonEnd === -1) {
      console.error("[kqed] Could not find JSON end");
      return [];
    }

    let state: any;
    try {
      state = JSON.parse(html.slice(jsonStart, jsonEnd + 1));
    } catch {
      console.error("[kqed] Failed to parse __INITIAL_STATE__");
      return [];
    }

    const posts: Record<string, any> = state.postsReducer ?? {};
    const attachments: Record<string, any> = state.attachmentsReducer ?? {};

    const events: ScrapedEvent[] = [];
    const now = Date.now();

    for (const [key, post] of Object.entries(posts)) {
      if (!key.startsWith("events_")) continue;
      if (!post.title || !post.startTime) continue;

      const startDate = new Date((post.startTime as number) * 1000);
      // Skip events that are more than a day in the past
      if (startDate.getTime() < now - 86400000) continue;

      const endDate = post.endTime
        ? new Date((post.endTime as number) * 1000)
        : undefined;

      // Resolve image from attachments: prefer medium_large for performance
      let imageUrl: string | undefined;
      if (post.featImg) {
        const att = attachments[post.featImg as string];
        if (att?.imgSizes) {
          imageUrl =
            att.imgSizes["medium_large"]?.file ??
            att.imgSizes["1536x1536"]?.file ??
            att.imgSizes["thumbnail"]?.file;
        }
      }

      const numericId = (key as string).replace("events_", "");
      const sourceUrl = `${this.EVENT_BASE_URL}/${numericId}`;

      const price = (post.eventPrice as string | undefined)?.trim() || undefined;

      events.push({
        title: (post.title as string).trim(),
        startDate,
        endDate,
        venueName: (post.venueName as string | undefined)?.trim() || undefined,
        price,
        isFree: price ? this.parseFree(price) : false,
        imageUrl,
        sourceUrl,
        tags: ["sf", "community"],
      });
    }

    console.log(`[kqed] Found ${events.length} upcoming events`);
    return events;
  }
}
