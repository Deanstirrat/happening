import { tagRecurringEvents } from "@/lib/recurring";

async function main() {
  console.log("Backfilling recurring event tags...");
  const tagged = await tagRecurringEvents();
  console.log(`Done — tagged ${tagged} events as recurring`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
