import { Flame } from "lucide-react";
import type { EventSummary } from "@/lib/types";
import { EventCardGrid } from "./EventCard";

interface TrendingRowProps {
  events: EventSummary[];
}

/**
 * "Trending this week" — the handful of upcoming events with the most community
 * interest (in-app hearts + scraped external counts). Interest votes already
 * influence ranking within a day; this surfaces the very top of that signal as
 * its own discovery row, so the social proof ("128 interested" on each card)
 * becomes a reason to look rather than a number that goes nowhere.
 *
 * Rendered between the featured carousel and the date groups, and only on the
 * default browse view — the page filters trending down to a meaningful set and
 * hides the section entirely when too few events qualify (see app/page.tsx).
 */
export default function TrendingRow({ events }: TrendingRowProps) {
  if (events.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="font-headline font-bold text-xl text-on-surface lowercase mb-3 flex items-center gap-2">
        <Flame size={18} className="text-primary shrink-0" fill="currentColor" />
        trending this week
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {events.map((event) => (
          <EventCardGrid key={event.id} event={event} />
        ))}
      </div>
    </section>
  );
}
