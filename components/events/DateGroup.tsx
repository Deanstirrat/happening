import { isTodaySF, isTomorrowSF, formatDateMediumSF } from "@/lib/sfDate";
import type { EventSummary } from "@/lib/types";
import { EventCardGrid } from "./EventCard";

interface DateGroupProps {
  date: Date;
  events: EventSummary[];
}

function formatDateLabel(date: Date): string {
  if (isTodaySF(date)) return "today";
  if (isTomorrowSF(date)) return "tomorrow";
  return formatDateMediumSF(date);
}

export default function DateGroup({ date, events }: DateGroupProps) {
  if (events.length === 0) return null;

  return (
    <section className="mb-12">
      {/* Date header */}
      <h2 className="font-headline font-bold text-2xl text-on-surface mb-4 lowercase">
        {formatDateLabel(date)}
        <span className="ml-3 font-body text-sm font-normal text-on-surface-variant">
          {events.length} event{events.length !== 1 ? "s" : ""}
        </span>
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {events.map((e) => (
          <EventCardGrid key={e.id} event={e} />
        ))}
      </div>
    </section>
  );
}
