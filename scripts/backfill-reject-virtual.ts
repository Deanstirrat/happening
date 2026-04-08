import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { prisma } from "@/lib/prisma";
import { isVirtualEvent } from "@/lib/scrapers/runner";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Scanning for virtual/online events... (${dryRun ? "DRY RUN" : "LIVE"})`);

  // Fetch all published events with the fields isVirtualEvent needs
  const events = await prisma.event.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, title: true, description: true, venueName: true },
  });

  const virtual = events.filter((e) => isVirtualEvent({ ...e, description: e.description ?? undefined, venueName: e.venueName ?? undefined }));
  console.log(`Found ${virtual.length} virtual events out of ${events.length} published`);

  for (const e of virtual) {
    console.log(`  [${dryRun ? "DRY" : "REJECT"}] "${e.title}" (venueName: ${e.venueName ?? "none"})`);
  }

  if (!dryRun && virtual.length > 0) {
    const result = await prisma.event.updateMany({
      where: { id: { in: virtual.map((e) => e.id) } },
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
