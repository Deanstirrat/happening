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
}

function formatDateLabel(date: Date): string {
  if (isTodaySF(date)) return "today";
  if (isTomorrowSF(date)) return "tomorrow";
  return formatDateMediumSF(date);
}

export default function DateGroup({ date, dayKey, events, initialHasMore = false }: DateGroupProps) {
  const [extra, setExtra] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const searchParams = useSearchParams();

  if (events.length === 0) return null;

  const allEvents = [...events, ...extra];

  async function loadMore() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("startDate", dayKey);
      params.set("endDate", dayKey);
      params.set("limit", "50");
      // Forward active filters so load-more respects them
      for (const key of ["hideRecurring", "hideMusic", "category", "neighborhood", "source", "isFree", "timeOfDay"]) {
        for (const val of searchParams.getAll(key)) {
          params.append(key, val);
        }
      }
      const res = await fetch(`/api/events?${params.toString()}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const shownIds = new Set(events.map((e) => e.id));
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
      setExtra(newEvents);
      setLoaded(true);
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
            {allEvents.length} event{allEvents.length !== 1 ? "s" : ""}
          </span>
        </h2>
        {collapsed
          ? <ChevronDown size={16} className="text-on-surface-variant shrink-0" />
          : <ChevronUp size={16} className="text-on-surface-variant shrink-0" />}
      </button>

      {!collapsed && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {allEvents.map((e) => (
              <EventCardGrid key={e.id} event={e} />
            ))}
          </div>

          {initialHasMore && !loaded && (
            <button
              onClick={loadMore}
              disabled={loading}
              className="mt-4 chip text-xs font-semibold disabled:opacity-50"
            >
              {loading ? "loading…" : `more events for ${formatDateLabel(date)}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
