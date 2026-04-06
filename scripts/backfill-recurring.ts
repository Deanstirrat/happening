import { tagRecurringEvents } from "@/lib/recurring";

async function main() {
  console.log("Backfilling recurring event tags and recurringType classification...");
  const tagged = await tagRecurringEvents();
  console.log(`Done — classified ${tagged} events (daily/weekly/biweekly/monthly/annual)`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
