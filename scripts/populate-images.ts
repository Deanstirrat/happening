import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { prisma } from "../lib/prisma";

const EVENT_IDS = [
  "cmn6peph5012zygr67el8muqh",
  "cmn6pe5hi012eygr69f13r6eb",
];

async function fetchImage(url: string): Promise<string | undefined> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
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

  // Unescape HTML entities
  ogImage = ogImage.replace(/&amp;/g, "&");

  // If it's a Next.js image proxy (/_next/image?url=...) extract the real URL
  const nextImageMatch = ogImage.match(/[?&]url=([^&]+)/);
  if (nextImageMatch) {
    let inner = decodeURIComponent(nextImageMatch[1]);
    // img.evbuc.com uses path-based proxying: https://img.evbuc.com/<encoded-cdn-url>
    if (inner.includes("img.evbuc.com/")) {
      const pathPart = inner.replace(/^https?:\/\/img\.evbuc\.com\//, "");
      inner = decodeURIComponent(pathPart).split("?")[0];
    }
    // Strip crop/resize query params and take just the base image URL
    try {
      const parsed = new URL(inner);
      // Keep the path only if it's a cdn.evbuc or similar final CDN
      if (!parsed.hostname.includes("_next") && !parsed.pathname.includes("_next")) {
        return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
      }
    } catch {
      // fall through
    }
    return inner.split("?")[0];
  }

  return ogImage;
}

async function main() {
  const events = await prisma.event.findMany({
    where: { id: { in: EVENT_IDS } },
    select: { id: true, title: true, sourceUrl: true, imageUrl: true },
  });

  for (const event of events) {
    console.log(`\n[${event.title}]`);
    console.log(`  sourceUrl: ${event.sourceUrl}`);
    const imageUrl = await fetchImage(event.sourceUrl);
    if (!imageUrl) {
      console.log("  ✗ No og:image found");
      continue;
    }
    await prisma.event.update({ where: { id: event.id }, data: { imageUrl } });
    console.log(`  ✓ imageUrl set: ${imageUrl}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
