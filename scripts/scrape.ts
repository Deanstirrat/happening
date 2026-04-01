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

const SCRAPER_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes per scraper
const PROCESS_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hour hard limit for the entire run

// Safety net: force-exit if the process is still running after 4 hours.
// This catches cases where a zombie browser or hung promise bypasses per-scraper timeouts.
const processTimer = setTimeout(() => {
  console.error("❌ Process exceeded 4-hour wall-clock limit — force exiting");
  process.exit(1);
}, PROCESS_TIMEOUT_MS);
processTimer.unref(); // Don't keep the event loop alive just for this timer

async function runWithTimeout(
  slug: string
): Promise<{ scraped: number; inserted: number } | null> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>(
    (_, reject) =>
      (timer = setTimeout(
        () => reject(new Error(`timed out after ${SCRAPER_TIMEOUT_MS / 1000}s`)),
        SCRAPER_TIMEOUT_MS
      ))
  );
  try {
    const result = await Promise.race([runScraper(slug), timeout]);
    clearTimeout(timer!);
    return result;
  } catch (err: any) {
    clearTimeout(timer!);
    console.error(`[${slug}] ❌ Failed: ${err.message}`);
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const slugs = args.length > 0 ? args : Object.keys(SCRAPERS);

  console.log(`\n🗓  happening scraper — running: ${slugs.join(", ")}\n`);

  let totalScraped = 0;
  let totalInserted = 0;
  const failed: string[] = [];

  for (const slug of slugs) {
    if (!SCRAPERS[slug]) {
      console.error(`Unknown scraper: ${slug}. Available: ${Object.keys(SCRAPERS).join(", ")}`);
      continue;
    }
    const result = await runWithTimeout(slug);
    if (result === null) {
      failed.push(slug);
    } else {
      totalScraped += result.scraped;
      totalInserted += result.inserted;
    }
  }

  // Retry any scrapers that failed or timed out
  if (failed.length > 0) {
    console.log(`\n🔄 Retrying ${failed.length} failed scraper(s): ${failed.join(", ")}\n`);
    const stillFailed: string[] = [];
    for (const slug of failed) {
      const result = await runWithTimeout(slug);
      if (result === null) {
        stillFailed.push(slug);
      } else {
        totalScraped += result.scraped;
        totalInserted += result.inserted;
      }
    }
    if (stillFailed.length > 0) {
      console.error(`\n❌ Scrapers still failing after retry: ${stillFailed.join(", ")}\n`);
      console.log(`\n✅ Done — ${totalInserted}/${totalScraped} new events inserted\n`);
      process.exit(1);
    }
  }

  console.log(`\n✅ Done — ${totalInserted}/${totalScraped} new events inserted\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
