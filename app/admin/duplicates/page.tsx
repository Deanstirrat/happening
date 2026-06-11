export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { CATEGORY_LABELS } from "@/lib/types";
import { formatDateTimeSF } from "@/lib/sfDate";
import { MERGE_CONFIDENCE, REVIEW_FLOOR } from "@/lib/merge/thresholds";
import AdminNav from "../_components/AdminNav";
import DuplicateActions from "./DuplicateActions";
import type { EventCategory } from "@prisma/client";
import { getAdminUser } from "@/lib/auth";
import { redirect } from "next/navigation";

interface Props {
  searchParams: Promise<{ take?: string }>;
}

// How many pairs to render per page. The uncertain band is small (the nightly
// adjudicator auto-merges confident dups and hides confident non-matches), so the
// default comfortably shows most queues in one screen.
const DEFAULT_TAKE = 60;

type DupEvent = {
  id: string;
  title: string;
  startDate: Date;
  venueName: string | null;
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

const EVENT_SELECT = {
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
} as const;

export default async function DuplicatesPage({ searchParams }: Props) {
  if (!(await getAdminUser())) redirect("/login");

  const { take: takeParam } = await searchParams;
  const take = Math.max(parseInt(takeParam ?? String(DEFAULT_TAKE), 10) || DEFAULT_TAKE, DEFAULT_TAKE);

  // The review queue is the *uncertain band*: pairs the nightly adjudicator
  // (scripts/merge-dups.ts) leaned toward "duplicate" but scored below the
  // auto-merge confidence. Pairs it confidently merged are already archived; pairs
  // it confidently rejected are hidden. This replaces the old raw-blocking firehose.
  const [band, dismissedRows] = await Promise.all([
    prisma.duplicateVerdict.findMany({
      where: { same: true, confidence: { gte: REVIEW_FLOOR, lt: MERGE_CONFIDENCE } },
      orderBy: { confidence: "desc" },
    }),
    prisma.duplicatePairDismissal.findMany({ select: { pairKey: true } }),
  ]);
  const dismissed = new Set(dismissedRows.map((d) => d.pairKey));

  // pairKey is `${minId}:${maxId}` — split back into the two event ids.
  const candidates = band
    .filter((v) => !dismissed.has(v.pairKey))
    .map((v) => {
      const [aId, bId] = v.pairKey.split(":");
      return { pairKey: v.pairKey, aId, bId, confidence: v.confidence, reason: v.reason };
    });

  // Resolve both events, keeping only pairs where BOTH are still live + upcoming.
  // (Either side may have since been merged, trashed, or fallen into the past.)
  const since = new Date();
  since.setDate(since.getDate() - 1);
  const ids = [...new Set(candidates.flatMap((c) => [c.aId, c.bId]))];
  const events = ids.length
    ? await prisma.event.findMany({
        where: { id: { in: ids }, status: { in: ["PUBLISHED", "PENDING"] }, startDate: { gte: since } },
        select: EVENT_SELECT,
      })
    : [];
  const byId = new Map(events.map((e) => [e.id, e as DupEvent]));

  const live = candidates.filter((c) => byId.has(c.aId) && byId.has(c.bId));
  const visible = live.slice(0, take);
  const hasMore = live.length > take;

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h1 className="font-headline font-black text-3xl text-on-surface lowercase">duplicates</h1>
        <AdminNav current="duplicates" />
        <p className="font-body text-on-surface-variant text-sm">
          {live.length} pair{live.length !== 1 ? "s" : ""} need review
          {dismissed.size > 0 ? ` · ${dismissed.size} dismissed` : ""}
        </p>
        <p className="font-body text-on-surface-variant text-xs">
          These are pairs the nightly adjudicator leaned toward &ldquo;duplicate&rdquo; but scored
          between {REVIEW_FLOOR.toFixed(2)} and {MERGE_CONFIDENCE.toFixed(2)} confidence — confident
          matches are merged automatically and confident non-matches are hidden.
        </p>
      </div>

      {visible.length === 0 ? (
        <p className="font-body text-on-surface-variant">Nothing to review. 🎉</p>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((c) => {
            const a = byId.get(c.aId)!;
            const b = byId.get(c.bId)!;
            return (
              <div
                key={c.pairKey}
                className="bg-surface-container rounded-2xl p-4 flex flex-col gap-3"
              >
                <div className="flex flex-col sm:flex-row gap-3 sm:items-stretch">
                  <EventCard e={a} />
                  <div className="hidden sm:block w-px bg-outline-variant shrink-0" />
                  <EventCard e={b} />
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-outline-variant pt-3">
                  <span className="font-body text-xs text-on-surface-variant">
                    likely dup · {c.confidence.toFixed(2)}
                    {c.reason ? ` — ${c.reason}` : ""}
                  </span>
                  <DuplicateActions aId={c.aId} bId={c.bId} />
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
