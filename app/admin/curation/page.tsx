export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import AdminNav from "../_components/AdminNav";
import AiSuggestions from "./AiSuggestions";
import EnrichFeatured from "./EnrichFeatured";
import InsightPanel from "./InsightPanel";
import { sfDayKey, sfDayStart, sfDayEnd } from "@/lib/sfDate";
import { addDays } from "date-fns";
import { getAdminUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function CurationPage() {
  if (!(await getAdminUser())) redirect("/login");

  const now = new Date();
  const todayKey = sfDayKey(now);
  const windowStart = sfDayStart(todayKey);
  const windowEnd = sfDayEnd(sfDayKey(addDays(now, 14)));

  const [featuredCount, weeklyCount, latestInsight] = await Promise.all([
    prisma.event.count({
      where: { status: "PUBLISHED", featured: true, startDate: { gte: now } },
    }),
    prisma.event.count({
      where: {
        status: "PUBLISHED",
        featured: false,
        startDate: { gte: windowStart, lte: windowEnd },
        NOT: [{ tags: { has: "recurring" } }, { tags: { has: "sfpl" } }],
      },
    }),
    prisma.curationInsight.findFirst({
      orderBy: { weekOf: "desc" },
      select: { weekOf: true, insight: true, createdAt: true },
    }),
  ]);

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h1 className="font-headline font-black text-3xl text-on-surface lowercase">
          curation
        </h1>
        <AdminNav current="curation" />
        <p className="font-body text-on-surface-variant text-sm">
          {weeklyCount} non-recurring unfeatured event
          {weeklyCount !== 1 ? "s" : ""} next 2 weeks ·{" "}
          {featuredCount} currently featured
        </p>
      </div>

      <AiSuggestions />

      <EnrichFeatured />

      <InsightPanel
        latest={
          latestInsight
            ? {
                weekOf: latestInsight.weekOf.toISOString(),
                insight: latestInsight.insight,
                createdAt: latestInsight.createdAt.toISOString(),
              }
            : null
        }
      />
    </div>
  );
}
