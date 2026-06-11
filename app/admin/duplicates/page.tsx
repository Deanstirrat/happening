export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { CATEGORY_LABELS } from "@/lib/types";
import { formatDateTimeSF } from "@/lib/sfDate";
import { generateCandidatePairs, type BlockEvent } from "@/lib/merge/blocking";
import { pairKey } from "@/lib/merge/executeMerge";
import AdminNav from "../_components/AdminNav";
import DuplicateActions from "./DuplicateActions";
import type { EventCategory } from "@prisma/client";
import { getAdminUser } from "@/lib/auth";
import { redirect } from "next/navigation";

interface Props {
  searchParams: Promise<{ take?: string }>;
}

// How many candidate pairs to render. Blocking can surface a lot of low-score
// pairs on busy days; the highest-scoring ones are the most likely true dups.
const DEFAULT_TAKE = 60;

type DupEvent = BlockEvent & {
  description: string | null;
  neighborhood: string | null;
  category: EventCategory | null;
  imageUrl: string | null;
  sourceUrl: string;
  status: string;
};

function host(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function EventCard({ e }: { e: DupEvent }) {
  return (
    <div className="flex-1 min-w-0 flex gap-3">
      {e.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={e.imageUrl}
          alt=""
          className="w-14 h-14 rounded-lg object-cover shrink-0 bg-surface-container-high"
        />
      ) : (
        <div className="w-14 h-14 rounded-lg shrink-0 bg-surface-container-high" />
      )}
      <div className="min-w-0">
        <p className="font-body font-semibold text-sm text-on-surface leading-tight">{e.title}</p>
        <p className="font-body text-xs text-on-surface-variant mt-0.5">
          {formatDateTimeSF(e.startDate)}
          {e.venueName && ` · ${e.venueName}`}
        </p>
        <p className="font-body text-xs text-on-surface-variant mt-0.5">
          {[e.neighborhood, e.category ? CATEGORY_LABELS[e.category] : null, host(e.sourceUrl)]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {e.description && (
          <p className="font-body text-xs text-on-surface-variant mt-1 line-clamp-2">
            {e.description}
          </p>
        )}
      </div>
    </div>
  );
}

export default async function DuplicatesPage({ searchParams }: Props) {
  if (!(await getAdminUser())) redirect("/login");

  const { take: takeParam } = await searchParams;

  const take = Math.max(parseInt(takeParam ?? String(DEFAULT_TAKE), 10) || DEFAULT_TAKE, DEFAULT_TAKE);

  // Comparison universe: upcoming live events (same shape the cron considers).
  const since = new Date();
  since.setDate(since.getDate() - 1);
  const events = await prisma.event.findMany({
    where: { status: { in: ["PUBLISHED", "PENDING"] }, startDate: { gte: since } },
    select: {
      id: true,
      title: true,
      venueName: true,
      startDate: true,
      description: true,
      neighborhood: true,
      category: true,
      imageUrl: true,
      sourceUrl: true,
      status: true,
    },
  });

  const byId = new Map(events.map((e) => [e.id, e as DupEvent]));
  const { pairs, truncatedDays } = generateCandidatePairs(
    events.map((e) => ({ id: e.id, title: e.title, venueName: e.venueName, startDate: e.startDate }))
  );

  // Drop pairs an admin already marked "not a duplicate".
  const dismissed = new Set(
    (await prisma.duplicatePairDismissal.findMany({ select: { pairKey: true } })).map((d) => d.pairKey)
  );

  const ranked = pairs
    .filter((p) => !dismissed.has(pairKey(p.a.id, p.b.id)))
    .sort((x, y) => y.score - x.score);
  const visible = ranked.slice(0, take);
  const hasMore = ranked.length > take;

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h1 className="font-headline font-black text-3xl text-on-surface lowercase">duplicates</h1>
        <AdminNav current="duplicates" />
        <p className="font-body text-on-surface-variant text-sm">
          {ranked.length} suspected duplicate pair{ranked.length !== 1 ? "s" : ""} across{" "}
          {events.length} upcoming events
          {dismissed.size > 0 ? ` · ${dismissed.size} dismissed` : ""}
        </p>
      </div>

      {truncatedDays.length > 0 && (
        <p className="font-body text-xs text-[#f59e0b]">
          ⚠ per-day pair cap hit on {truncatedDays.length} day(s); some lower-scoring pairs are
          hidden.
        </p>
      )}

      {visible.length === 0 ? (
        <p className="font-body text-on-surface-variant">No suspected duplicates. 🎉</p>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((p) => {
            const a = byId.get(p.a.id);
            const b = byId.get(p.b.id);
            if (!a || !b) return null;
            return (
              <div
                key={pairKey(p.a.id, p.b.id)}
                className="bg-surface-container rounded-2xl p-4 flex flex-col gap-3"
              >
                <div className="flex flex-col sm:flex-row gap-3 sm:items-stretch">
                  <EventCard e={a} />
                  <div className="hidden sm:block w-px bg-outline-variant shrink-0" />
                  <EventCard e={b} />
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-outline-variant pt-3">
                  <span className="font-body text-xs text-on-surface-variant">
                    match score {p.score}
                  </span>
                  <DuplicateActions aId={p.a.id} bId={p.b.id} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasMore && (
        <a
          href={`/admin/duplicates?take=${take + DEFAULT_TAKE}`}
          className="font-body text-sm font-semibold px-6 py-2 rounded-full bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors self-start"
        >
          Load more
        </a>
      )}
    </div>
  );
}
