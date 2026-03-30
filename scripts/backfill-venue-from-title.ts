import { prisma } from "@/lib/prisma";

function extractLocationFromTitle(title: string): string | null {
  const match = title.match(/\b(?:at|in)\s+([a-z][a-z\s']+?)(?:\s+on\b|\s+this\b|\s*$)/i);
  if (!match) return null;
  const candidate = match[1].trim();
  if (candidate.split(" ").length < 2 && candidate.length < 6) return null;
  return candidate.replace(/\b\w/g, (c) => c.toUpperCase());
}

async function main() {
  const events = await prisma.event.findMany({
    where: { venueName: null, venueAddress: null },
    select: { id: true, title: true },
  });

  console.log(`Found ${events.length} events with no venue data`);

  let updated = 0;
  for (const event of events) {
    const venueName = extractLocationFromTitle(event.title);
    if (!venueName) continue;
    await prisma.event.update({ where: { id: event.id }, data: { venueName } });
    console.log(`  ${event.title} → ${venueName}`);
    updated++;
  }

  console.log(`\nDone — updated ${updated} / ${events.length} events`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
