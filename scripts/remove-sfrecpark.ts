/**
 * Disables the sfrecpark source and deletes all its events.
 *
 * Run: npx tsx scripts/remove-sfrecpark.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { prisma } from "../lib/prisma";

async function main() {
  const source = await prisma.source.findUnique({
    where: { slug: "sfrecpark" },
  });
  if (!source) {
    console.log("sfrecpark source not found — nothing to do");
    await prisma.$disconnect();
    return;
  }

  const { count } = await prisma.event.deleteMany({
    where: { sourceId: source.id },
  });
  console.log(`Deleted ${count} sfrecpark events`);

  await prisma.source.update({
    where: { slug: "sfrecpark" },
    data: { enabled: false },
  });
  console.log("sfrecpark source disabled");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
