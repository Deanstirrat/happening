import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { prisma } from "@/lib/prisma";
import { isSpamEvent } from "@/lib/ingestFilters";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Scanning for spam events... (${dryRun ? "DRY RUN" : "LIVE"})`);

  // Fetch all published events with the fields isSpamEvent needs
  const events = await prisma.event.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, title: true },
  });

  const spam = events.filter((e) => isSpamEvent(e));
  console.log(`Found ${spam.length} spam events out of ${events.length} published`);

  for (const e of spam) {
    console.log(`  [${dryRun ? "DRY" : "REJECT"}] "${e.title}"`);
  }

  if (!dryRun && spam.length > 0) {
    const result = await prisma.event.updateMany({
      where: { id: { in: spam.map((e) => e.id) } },
      data: { status: "REJECTED" },
    });
    console.log(`\nRejected ${result.count} events.`);
  } else if (dryRun) {
    console.log("\nDry run — no changes made. Re-run without --dry-run to apply.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
