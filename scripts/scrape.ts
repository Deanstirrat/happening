#!/usr/bin/env ts-node
/**
 * CLI scrape runner.
 * Usage:
 *   npx ts-node scripts/scrape.ts              # run all scrapers
 *   npx ts-node scripts/scrape.ts foopee       # run one scraper
 *   npx ts-node scripts/scrape.ts 19hz meetup  # run multiple
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { runScraper, SCRAPERS } from "../lib/scrapers/runner";

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const slugs = args.length > 0 ? args : Object.keys(SCRAPERS);

  console.log(`\n🗓  happening scraper — running: ${slugs.join(", ")}\n`);

  let totalScraped = 0;
  let totalInserted = 0;

  for (const slug of slugs) {
    if (!SCRAPERS[slug]) {
      console.error(`Unknown scraper: ${slug}. Available: ${Object.keys(SCRAPERS).join(", ")}`);
      continue;
    }
    const result = await runScraper(slug);
    totalScraped += result.scraped;
    totalInserted += result.inserted;
  }

  console.log(`\n✅ Done — ${totalInserted}/${totalScraped} new events inserted\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
