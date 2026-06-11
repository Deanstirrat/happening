import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { prisma } from "../lib/prisma";
import { decodeHtmlEntities } from "../lib/decodeEntities";

const CONCURRENCY = 5;
const DESCRIPTION_MAX_LENGTH = 500;

// Sources whose listing pages don't have meaningful og:description
// (foopee/19hz use the same URL for all events on a day)
const SKIP_SOURCE_SLUGS = new Set(["foopee", "19hz"]);

function extractOgDescription(html: string): string | undefined {
  const match =
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i) ??
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  if (!match?.[1]) return undefined;
  let desc = decodeHtmlEntities(match[1]);
  if (!desc) return undefined;
  if (desc.length > DESCRIPTION_MAX_LENGTH) {
    desc = desc.slice(0, DESCRIPTION_MAX_LENGTH).replace(/\s+\S*$/, "") + "…";
  }
  return desc;
}

async function fetchDescription(url: string): Promise<string | undefined> {
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
    return extractOgDescription(html);
  } catch {
    return undefined;
  }
}

async function main() {
  const events = await prisma.event.findMany({
    where: { description: null },
    select: { id: true, title: true, sourceUrl: true, source: { select: { slug: true } } },
    orderBy: { startDate: "desc" },
  });

  const eligible = events.filter((e) => !SKIP_SOURCE_SLUGS.has(e.source?.slug ?? ""));
  console.log(`Found ${events.length} events without descriptions (${eligible.length} eligible after filtering)`);

  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < eligible.length; i += CONCURRENCY) {
    const batch = eligible.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (event) => {
        const description = await fetchDescription(event.sourceUrl);
        if (description) {
          await prisma.event.update({ where: { id: event.id }, data: { description } });
          console.log(`  ✓ ${event.title}`);
          updated++;
        } else {
          skipped++;
        }
      })
    );

    if ((i / CONCURRENCY) % 10 === 9) {
      console.log(`  ... ${i + CONCURRENCY}/${eligible.length} processed, ${updated} updated so far`);
    }
  }

  console.log(`\nDone — ${updated} updated, ${skipped} had no description.`);
  await prisma.$disconnect();
}

main().catch(console.error);
