import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import axios from "axios";
import { prisma } from "@/lib/prisma";

/**
 * One-time purge for sflive online-only events that published before the scraper
 * learned to drop them (lib/scrapers/sflive.ts). sflive geocodes these to a real
 * physical venue (e.g. Gray Area's "Online Intensive Course …" at 2665 Mission),
 * so isVirtualEvent — which keys off venue/title/description — never catches them.
 *
 * The reliable signal is an explicit "Online"/"Virtual" tag in vibemap_event_tags.
 * We pull the live sflive feed, collect the source URLs of tagged events, and
 * reject the matching PUBLISHED rows — the exact set the scraper now skips.
 */
const BASE_URL = "https://sflive.art";
const PER_PAGE = 100;

async function collectOnlineTaggedUrls(): Promise<Set<string>> {
  const urls = new Set<string>();
  let page = 1;
  let totalPages = 1;

  do {
    let items: any[] = [];
    try {
      const res = await axios.get(`${BASE_URL}/wp-json/wp/v2/vibemap_event`, {
        params: { per_page: PER_PAGE, page },
        headers: { "User-Agent": "Mozilla/5.0 (compatible; happening-sf/1.0)" },
        timeout: 15000,
      });
      if (page === 1) {
        totalPages = parseInt(res.headers["x-wp-totalpages"] ?? "1", 10);
      }
      items = res.data;
    } catch (err: any) {
      if (err.response?.status === 400) break;
      throw err;
    }

    for (const item of items) {
      const m = item.meta ?? {};
      const tagged = String(m.vibemap_event_tags ?? "")
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .some((t) => t === "online" || t === "virtual");
      if (!tagged) continue;
      const url: string = m.vibemap_event_url || item.link || "";
      if (url) urls.add(url);
    }
    page++;
  } while (page <= totalPages);

  return urls;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(
    `Purging sflive online-tagged events... (${dryRun ? "DRY RUN" : "LIVE"})`
  );

  const urls = await collectOnlineTaggedUrls();
  console.log(`Found ${urls.size} online-tagged source URLs in the sflive feed.`);

  const events = await prisma.event.findMany({
    where: { status: "PUBLISHED", sourceUrl: { in: [...urls] } },
    select: { id: true, title: true, venueName: true, sourceUrl: true },
  });
  console.log(`Matched ${events.length} PUBLISHED event(s) to reject:\n`);
  for (const e of events) {
    console.log(`  [${dryRun ? "DRY" : "REJECT"}] ${e.id} "${e.title}" (${e.venueName ?? "no venue"})`);
  }

  if (!dryRun && events.length > 0) {
    const result = await prisma.event.updateMany({
      where: { id: { in: events.map((e) => e.id) } },
      data: { status: "REJECTED" },
    });
    console.log(`\nRejected ${result.count} event(s).`);
  } else if (dryRun) {
    console.log("\nDry run — no changes made. Re-run without --dry-run to apply.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
