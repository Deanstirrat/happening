export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import AdminNav from "../_components/AdminNav";
import AiSuggestions from "./AiSuggestions";
import { sfDayKey, sfDayStart, sfDayEnd } from "@/lib/sfDate";
import { addDays } from "date-fns";

interface Props {
  searchParams: Promise<{ secret?: string }>;
}

export default async function CurationPage({ searchParams }: Props) {
  const { secret } = await searchParams;

  if (!secret || secret !== process.env.SCRAPE_SECRET) {
    return (
      <div className="max-w-screen-md mx-auto px-6 py-16 text-center">
        <p className="font-body text-on-surface-variant">Access denied.</p>
      </div>
    );
  }

  const now = new Date();
  const todayKey = sfDayKey(now);
  const windowStart = sfDayStart(todayKey);
  const windowEnd = sfDayEnd(sfDayKey(addDays(now, 14)));

  const [featuredCount, weeklyCount] = await Promise.all([
    prisma.event.count({
      where: { status: "PUBLISHED", featured: true, startDate: { gte: now } },
    }),
    prisma.event.count({
      where: {
        status: "PUBLISHED",
        featured: false,
        startDate: { gte: windowStart, lte: windowEnd },
        NOT: { tags: { has: "recurring" } },
        NOT: { tags: { has: "sfpl" } },
      },
    }),
  ]);

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h1 className="font-headline font-black text-3xl text-on-surface lowercase">
          curation
        </h1>
        <AdminNav secret={secret} current="curation" />
        <p className="font-body text-on-surface-variant text-sm">
          {weeklyCount} non-recurring unfeatured event
          {weeklyCount !== 1 ? "s" : ""} next 2 weeks ·{" "}
          {featuredCount} currently featured
        </p>
      </div>

      <AiSuggestions secret={secret} />
    </div>
  );
}
