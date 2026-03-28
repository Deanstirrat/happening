import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { prisma } from "../lib/prisma";

const CONCURRENCY = 5;

async function fetchImage(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();

    // For Eventbrite: extract image from embedded __SERVER_DATA__ JSON
    if (url.includes("eventbrite.com")) {
      const serverDataMatch = html.match(
        /window\.__SERVER_DATA__\s*=\s*(\{[\s\S]*?\});\s*(?:window\.|<\/script>)/
      );
      if (serverDataMatch) {
        try {
          const data = JSON.parse(serverDataMatch[1]);
          const event =
            data?.event ??
            data?.eventPage?.event ??
            data?.components?.event_detail?.event;
          const imageUrl =
            event?.image?.url ?? event?.logo?.url ?? event?.image_url;
          if (imageUrl) return imageUrl;
        } catch {
          // fall through
        }
      }
    }

    // Generic fallback: OG image meta tag
    const match =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    let ogImage = match?.[1];
    if (!ogImage) return undefined;

    ogImage = ogImage.replace(/&amp;/g, "&");

    const nextImageMatch = ogImage.match(/[?&]url=([^&]+)/);
    if (nextImageMatch) {
      let inner = decodeURIComponent(nextImageMatch[1]);
      if (inner.includes("img.evbuc.com/")) {
        const pathPart = inner.replace(/^https?:\/\/img\.evbuc\.com\//, "");
        inner = decodeURIComponent(pathPart).split("?")[0];
      }
      try {
        const parsed = new URL(inner);
        if (!parsed.hostname.includes("_next") && !parsed.pathname.includes("_next")) {
          return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
        }
      } catch {
        // fall through
      }
      return inner.split("?")[0];
    }

    return ogImage;
  } catch {
    return undefined;
  }
}

/**
 * For funcheap detail pages that lack og:image, extract from noscript SPAI
 * tags and strip the WordPress resize suffix to get the original full-size image.
 */
async function fetchFuncheapImage(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();

    // First try og:image
    const ogMatch =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (ogMatch?.[1]) return ogMatch[1];

    // Funcheap uses SPAI — real URLs are in <noscript> tags.
    // Find the first noscript that has an upload image (not a theme/logo image).
    const noscriptMatches = [...html.matchAll(/<noscript[^>]*>([\s\S]*?)<\/noscript>/gi)];
    for (const m of noscriptMatches) {
      const imgMatch = m[1].match(/src=["']([^"']+)["']/i);
      if (!imgMatch?.[1]) continue;
      const src = imgMatch[1];
      // Only consider images from wp-content/uploads (not theme files)
      if (!src.includes("wp-content/uploads") && !src.includes("cdn.funcheap.com/wp-content/uploads")) continue;
      let imgUrl = src;
      // Strip SPAI proxy: cdn.shortpixel.ai/spai/<params>/<actual-url>
      const spaiMatch = imgUrl.match(/cdn\.shortpixel\.ai\/spai\/[^/]+\/(.+)/);
      if (spaiMatch) imgUrl = `https://${spaiMatch[1]}`;
      // Strip WordPress resize suffix: -NNNxNNN before extension
      imgUrl = imgUrl.replace(/-\d+x\d+(\.[a-z]+)$/i, "$1");
      return imgUrl;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

async function backfillFuncheap() {
  console.log("\n=== Backfilling funcheap event images from detail pages ===");
  // Fetch og:image from each funcheap event's detail page (full-res), replacing
  // any previously stored low-res thumbnails (including stripped SPAI URLs).
  const events = await prisma.event.findMany({
    where: { source: { slug: "funcheap" } },
    select: { id: true, title: true, sourceUrl: true, imageUrl: true },
  });
  console.log(`Found ${events.length} funcheap events`);

  let updated = 0;
  for (let i = 0; i < events.length; i += CONCURRENCY) {
    const batch = events.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (event) => {
        const imageUrl = await fetchFuncheapImage(event.sourceUrl);
        if (imageUrl && imageUrl !== event.imageUrl) {
          await prisma.event.update({ where: { id: event.id }, data: { imageUrl } });
          console.log(`  ✓ ${event.title}`);
          console.log(`    → ${imageUrl}`);
          updated++;
        } else if (!imageUrl) {
          console.log(`  ✗ ${event.title} (no image found)`);
        }
      })
    );
  }
  console.log(`Done — ${updated}/${events.length} updated.`);
}

async function backfill19hz() {
  console.log("\n=== Backfilling 19hz events missing images ===");
  const events = await prisma.event.findMany({
    where: {
      imageUrl: null,
      source: { slug: "19hz" },
    },
    select: { id: true, title: true, sourceUrl: true },
  });
  console.log(`Found ${events.length} events without images`);

  let updated = 0;
  for (let i = 0; i < events.length; i += CONCURRENCY) {
    const batch = events.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (event) => {
        // Skip 19hz.info listing page itself — no useful image there
        if (event.sourceUrl.includes("19hz.info")) return;
        const imageUrl = await fetchImage(event.sourceUrl);
        if (imageUrl) {
          await prisma.event.update({ where: { id: event.id }, data: { imageUrl } });
          console.log(`  ✓ ${event.title} → ${imageUrl}`);
          updated++;
        } else {
          console.log(`  ✗ ${event.title} (${event.sourceUrl})`);
        }
      })
    );
  }
  console.log(`Done — ${updated}/${events.length} updated.`);
}

async function backfillBandsintown() {
  console.log("\n=== Backfilling Bandsintown events missing images ===");
  const events = await prisma.event.findMany({
    where: { imageUrl: null, source: { slug: "bandsintown" } },
    select: { id: true, title: true, sourceUrl: true },
  });
  console.log(`Found ${events.length} events without images`);
  if (events.length === 0) return;

  // Bandsintown is a JS SPA — og:image is only available after JS renders.
  // We reuse a single Playwright browser instance for all fetches.
  const { chromium } = await import("playwright-extra");
  const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: true, channel: "chrome" });

  let updated = 0;
  try {
    const page = await browser.newPage();
    for (const event of events) {
      try {
        await page.goto(event.sourceUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        const candidate = await page.evaluate(() => {
          // Prefer og:image meta tag
          const meta = document.querySelector('meta[property="og:image"]');
          const og = meta?.getAttribute("content") ?? null;
          if (og && !og.includes("assets.prod.bandsintown.com") && !og.includes("/null.")) return og;
          // Fall back to any photos.bandsintown.com img on the page
          const img = document.querySelector('img[src*="photos.bandsintown.com"]') as HTMLImageElement | null;
          return img?.src ?? null;
        });
        if (candidate && !candidate.includes("assets.prod.bandsintown.com") && !candidate.includes("/null.")) {
          // Decode Next.js image proxy URLs: /_next/image?url=<encoded-url>
          const nextImgParam = candidate.match(/[?&]url=([^&]+)/);
          const resolved = nextImgParam ? decodeURIComponent(nextImgParam[1]) : candidate;
          // Upgrade thumbnail to large image (same as scraper does)
          const imageUrl = resolved.replace("/thumb/", "/large/");
          await prisma.event.update({ where: { id: event.id }, data: { imageUrl } });
          console.log(`  ✓ ${event.title} → ${imageUrl}`);
          updated++;
        } else {
          console.log(`  ✗ ${event.title} (no usable image)`);
        }
      } catch {
        console.log(`  ✗ ${event.title} (fetch failed)`);
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`Done — ${updated}/${events.length} updated.`);
}

async function main() {
  await backfillFuncheap();
  await backfill19hz();
  await backfillBandsintown();
  await prisma.$disconnect();
}

main().catch(console.error);
