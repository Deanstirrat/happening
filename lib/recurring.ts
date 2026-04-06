import { prisma } from "@/lib/prisma";
import { RecurringType } from "@prisma/client";

const MIN_OCCURRENCES = 4;
const MIN_SPAN_DAYS = 21;
// Secondary threshold: dense series (≥4 occurrences over ≥3 days) — catches
// weekly/daily library programs before they've accumulated 21 days of history.
const MIN_OCCURRENCES_FREQUENT = 4;
const MIN_SPAN_DAYS_FREQUENT = 2;

/**
 * Classifies a recurring event title into a RecurringType based on the
 * average interval between occurrences (span / (count - 1)).
 */
function classifyRecurringType(
  count: number,
  spanDays: number
): RecurringType | null {
  if (count < 2) return null;
  const avgInterval = spanDays / (count - 1);

  if (avgInterval < 2) return RecurringType.DAILY;
  if (avgInterval < 10) return RecurringType.WEEKLY;
  if (avgInterval < 20) return RecurringType.BIWEEKLY;
  if (avgInterval < 60) return RecurringType.MONTHLY;
  if (avgInterval >= 300 && avgInterval <= 600) return RecurringType.ANNUAL;

  return null; // unclassified (e.g., 60–300 day avg — too irregular to name)
}

/**
 * Tags events as "recurring" and sets recurringType based on title frequency
 * and date span.
 *
 * A title qualifies when it appears >= MIN_OCCURRENCES times with
 * max(startDate) - min(startDate) >= MIN_SPAN_DAYS.
 *
 * Annual events get a recurringType of ANNUAL but do NOT receive the
 * "recurring" tag, so they are never hidden by hideRecurring filters.
 *
 * @param titleFilter - If provided, only titles in this list are considered.
 *                      Pass the titles from the current scrape batch for
 *                      efficient per-run tagging.
 * @returns Number of event records updated.
 */
export async function tagRecurringEvents(titleFilter?: string[]): Promise<number> {
  const groups = await prisma.event.groupBy({
    by: ["title"],
    where: titleFilter ? { title: { in: titleFilter } } : undefined,
    _count: { id: true },
    _min: { startDate: true },
    _max: { startDate: true },
  });

  // Build a map of title → RecurringType for qualifying groups
  const titleToType = new Map<string, RecurringType>();

  for (const g of groups) {
    if (!g._min.startDate || !g._max.startDate) continue;
    const spanMs = g._max.startDate.getTime() - g._min.startDate.getTime();
    const spanDays = spanMs / (1000 * 60 * 60 * 24);
    const count = g._count.id;

    const meetsStandard = count >= MIN_OCCURRENCES && spanDays >= MIN_SPAN_DAYS;
    const meetsFrequent = count >= MIN_OCCURRENCES_FREQUENT && spanDays >= MIN_SPAN_DAYS_FREQUENT;

    if (!meetsStandard && !meetsFrequent) continue;

    const type = classifyRecurringType(count, spanDays);
    if (type) {
      titleToType.set(g.title, type);
    }
  }

  if (titleToType.size === 0) return 0;

  let totalUpdated = 0;

  // Group titles by their RecurringType for efficient bulk updates
  const byType = new Map<RecurringType, string[]>();
  for (const [title, type] of titleToType) {
    const list = byType.get(type) ?? [];
    list.push(title);
    byType.set(type, list);
  }

  for (const [type, titles] of byType) {
    // For non-annual types: set recurringType and add "recurring" tag
    // For annual: set recurringType only — do NOT add "recurring" tag
    if (type !== RecurringType.ANNUAL) {
      const result = await prisma.event.updateMany({
        where: {
          title: { in: titles },
          recurringType: null,
          NOT: { tags: { has: "recurring" } },
        },
        data: {
          recurringType: type,
          tags: { push: "recurring" },
        },
      });
      totalUpdated += result.count;

      // Also update recurringType on events that already have the tag
      // (e.g., previously classified but type was unset)
      const typeOnly = await prisma.event.updateMany({
        where: {
          title: { in: titles },
          recurringType: null,
          tags: { has: "recurring" },
        },
        data: { recurringType: type },
      });
      totalUpdated += typeOnly.count;
    } else {
      // Annual: only set recurringType, never add "recurring" tag
      const result = await prisma.event.updateMany({
        where: {
          title: { in: titles },
          recurringType: null,
        },
        data: { recurringType: RecurringType.ANNUAL },
      });
      totalUpdated += result.count;
    }
  }

  return totalUpdated;
}
