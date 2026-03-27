import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });
import { prisma } from "../lib/prisma";

async function main() {
  const ids = [
    "cmn6pe80l012hygr63xx1slq4",
    "cmn6pqrta01ftygr6d9gkzg6w",
    "cmn7uyadj000pj1r6faa5ddtg",
  ];
  const events = await prisma.event.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true, startDate: true, sourceUrl: true, venueName: true },
  });
  for (const e of events) {
    console.log(`id: ${e.id}`);
    console.log(`  title:    ${e.title}`);
    console.log(`  date:     ${e.startDate.toISOString()}`);
    console.log(`  venue:    ${e.venueName}`);
    console.log(`  source:   ${e.sourceUrl}`);
  }
  await prisma.$disconnect();
}
main();
