import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { prisma } from "@/lib/prisma";
import { isCanceledEvent } from "@/lib/ingestFilters";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Scanning for cancelled/postponed events... (${dryRun ? "DRY RUN" : "LIVE"})`);

  // Fetch all published events with the fields isCanceledEvent needs
  const events = await prisma.event.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, title: true, description: true },
  });

  const canceled = events.filter((e) => isCanceledEvent({ ...e, description: e.description ?? undefined }));
  console.log(`Found ${canceled.length} cancelled events out of ${events.length} published`);

  for (const e of canceled) {
    console.log(`  [${dryRun ? "DRY" : "REJECT"}] "${e.title}"`);
  }

  if (!dryRun && canceled.length > 0) {
    const result = await prisma.event.updateMany({
      where: { id: { in: canceled.map((e) => e.id) } },
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
