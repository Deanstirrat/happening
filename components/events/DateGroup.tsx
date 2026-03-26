import { isTodaySF, isTomorrowSF, formatDateMediumSF } from "@/lib/sfDate";
import type { EventSummary } from "@/lib/types";
import EventCard, { EventCardGrid } from "./EventCard";

interface DateGroupProps {
  date: Date;
  events: EventSummary[];
  featured?: boolean;
}

function formatDateLabel(date: Date): string {
  if (isTodaySF(date)) return "today";
  if (isTomorrowSF(date)) return "tomorrow";
  return formatDateMediumSF(date);
}

export default function DateGroup({ date, events, featured = false }: DateGroupProps) {
  if (events.length === 0) return null;

  const [featuredEvent, ...rest] = events;

  return (
    <section className="mb-12">
      {/* Date header */}
      <h2 className="font-headline font-bold text-2xl text-on-surface mb-4 lowercase">
        {formatDateLabel(date)}
        <span className="ml-3 font-body text-sm font-normal text-on-surface-variant">
          {events.length} event{events.length !== 1 ? "s" : ""}
        </span>
      </h2>

      {featured && featuredEvent ? (
        <>
          {/* Featured layout: big card left + side cards right */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 mb-4">
            <EventCard event={featuredEvent} featured />
            <div className="flex flex-col gap-3">
              {rest.slice(0, 3).map((e) => (
                <EventCard key={e.id} event={e} />
              ))}
            </div>
          </div>
          {/* Remaining as grid */}
          {rest.length > 3 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {rest.slice(3).map((e) => (
                <EventCardGrid key={e.id} event={e} />
              ))}
            </div>
          )}
        </>
      ) : (
        /* Non-featured: grid layout */
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {events.map((e) => (
            <EventCardGrid key={e.id} event={e} />
          ))}
        </div>
      )}
    </section>
  );
}
