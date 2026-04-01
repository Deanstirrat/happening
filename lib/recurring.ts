import { prisma } from "@/lib/prisma";

const MIN_OCCURRENCES = 4;
const MIN_SPAN_DAYS = 21;
// Secondary threshold: dense series (≥4 occurrences over ≥3 days) — catches
// weekly/daily library programs before they've accumulated 21 days of history.
const MIN_OCCURRENCES_FREQUENT = 4;
const MIN_SPAN_DAYS_FREQUENT = 2;

/**
 * Tags events as "recurring" based on title frequency and date span.
 * A title qualifies when it appears >= MIN_OCCURRENCES times with
 * max(startDate) - min(startDate) >= MIN_SPAN_DAYS.
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

  const recurringTitles = groups
    .filter((g) => {
      if (!g._min.startDate || !g._max.startDate) return false;
      const spanMs = g._max.startDate.getTime() - g._min.startDate.getTime();
      const spanDays = spanMs / (1000 * 60 * 60 * 24);
      if (g._count.id >= MIN_OCCURRENCES && spanDays >= MIN_SPAN_DAYS) return true;
      if (g._count.id >= MIN_OCCURRENCES_FREQUENT && spanDays >= MIN_SPAN_DAYS_FREQUENT) return true;
      return false;
    })
    .map((g) => g.title);

  if (recurringTitles.length === 0) return 0;

  const result = await prisma.event.updateMany({
    where: {
      title: { in: recurringTitles },
      NOT: { tags: { has: "recurring" } },
    },
    data: { tags: { push: "recurring" } },
  });

  return result.count;
}
