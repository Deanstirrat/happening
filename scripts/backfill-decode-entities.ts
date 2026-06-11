import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { prisma } from "../lib/prisma";
import { decodeHtmlEntities } from "../lib/decodeEntities";

/**
 * One-off backfill: re-decode HTML entity artifacts (e.g. `&#x27;`, `&amp;#x27;`,
 * `&#8217;`) left in scraped event titles and descriptions before the decoder
 * was hardened. Idempotent — clean text has no entity sequences to change.
 */

// Only consider rows that still contain an entity-looking sequence.
const ENTITY_RE = /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/;

async function main() {
  const events = await prisma.event.findMany({
    where: {
      OR: [{ title: { contains: "&" } }, { description: { contains: "&" } }],
    },
    select: { id: true, title: true, description: true },
  });

  console.log(`Scanning ${events.length} events containing '&'…`);

  let updated = 0;
  for (const e of events) {
    const data: { title?: string; description?: string } = {};

    if (e.title && ENTITY_RE.test(e.title)) {
      const decoded = decodeHtmlEntities(e.title);
      if (decoded && decoded !== e.title) data.title = decoded;
    }
    if (e.description && ENTITY_RE.test(e.description)) {
      const decoded = decodeHtmlEntities(e.description);
      if (decoded && decoded !== e.description) data.description = decoded;
    }

    if (Object.keys(data).length === 0) continue;

    await prisma.event.update({ where: { id: e.id }, data });
    updated++;
    if (data.title) console.log(`  title:  ${e.title}\n       → ${data.title}`);
    if (data.description) console.log(`  desc:   ${e.description}\n       → ${data.description}`);
  }

  console.log(`\nDone — updated ${updated} / ${events.length} events`);
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
