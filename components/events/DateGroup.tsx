"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";
import { isTodaySF, isTomorrowSF, formatDateMediumSF } from "@/lib/sfDate";
import type { EventSummary } from "@/lib/types";
import { EventCardGrid } from "./EventCard";

interface DateGroupProps {
  date: Date;
  dayKey: string;
  events: EventSummary[];
  initialHasMore?: boolean;
  totalCount?: number;
}

function formatDateLabel(date: Date): string {
  if (isTodaySF(date)) return "today";
  if (isTomorrowSF(date)) return "tomorrow";
  return formatDateMediumSF(date);
}

const PAGE_SIZE = 50;

export default function DateGroup({ date, dayKey, events, initialHasMore = false, totalCount }: DateGroupProps) {
  const [extra, setExtra] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [nextPage, setNextPage] = useState(0);
  const [hasMorePages, setHasMorePages] = useState(initialHasMore);
  const [collapsed, setCollapsed] = useState(false);
  const searchParams = useSearchParams();

  if (events.length === 0) return null;

  const allEvents = [...events, ...extra];
  const trueTotal = totalCount ?? allEvents.length;
  const hasMore = hasMorePages && allEvents.length < trueTotal;
  const remaining = trueTotal - allEvents.length;

  async function loadMore() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("startDate", dayKey);
      params.set("endDate", dayKey);
      params.set("limit", String(PAGE_SIZE));
      params.set("page", String(nextPage + 1));
      for (const key of ["hideRecurring", "hideMusic", "category", "excludeCategory", "neighborhood", "source", "excludeSource", "isFree", "timeOfDay", "forYou", "sort"]) {
        for (const val of searchParams.getAll(key)) {
          params.append(key, val);
        }
      }
      const res = await fetch(`/api/events?${params.toString()}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const shownIds = new Set(allEvents.map((e) => e.id));
      const newEvents = (data.events as EventSummary[])
        .map((e) => ({
          ...e,
          startDate: typeof e.startDate === "string" ? e.startDate : new Date(e.startDate).toISOString(),
          endDate: e.endDate
            ? typeof e.endDate === "string" ? e.endDate : new Date(e.endDate).toISOString()
            : null,
          featuredAt: e.featuredAt
            ? typeof e.featuredAt === "string" ? e.featuredAt : new Date(e.featuredAt).toISOString()
            : null,
        }))
        .filter((e) => !shownIds.has(e.id));
      if (newEvents.length === 0 || data.events.length < PAGE_SIZE) {
        setHasMorePages(false);
      }
      setExtra((prev) => [...prev, ...newEvents]);
      setNextPage((p) => p + 1);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mb-12">
      {/* Date header — clickable to collapse */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-2 mb-4 w-full text-left"
      >
        <h2 className="font-headline font-bold text-2xl text-on-surface lowercase">
          {formatDateLabel(date)}
          <span className="ml-3 font-body text-sm font-normal text-on-surface-variant">
            {trueTotal} event{trueTotal !== 1 ? "s" : ""}
          </span>
        </h2>
        {collapsed
          ? <ChevronUp size={16} className="text-on-surface-variant shrink-0" />
          : <ChevronDown size={16} className="text-on-surface-variant shrink-0" />}
      </button>

      {!collapsed && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {allEvents.map((e) => (
              <div key={e.id} className="reveal-scroll">
                <EventCardGrid event={e} />
              </div>
            ))}
          </div>

          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loading}
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-outline-variant px-5 py-2.5 font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant transition-all hover:text-on-surface hover:border-outline hover:shadow-[0_0_20px_rgba(255,0,0,0.12)] disabled:opacity-50"
            >
              <ChevronDown size={13} className={loading ? "animate-bounce" : ""} />
              {loading ? "loading…" : `show ${Math.min(PAGE_SIZE, remaining)} more`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
