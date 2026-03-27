"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { EventSummary } from "@/lib/types";
import EventCard from "./EventCard";
import FeaturedTracker from "./FeaturedTracker";
import { formatDateShortSF } from "@/lib/sfDate";

interface FeaturedCarouselProps {
  events: EventSummary[];
}

export default function FeaturedCarousel({ events }: FeaturedCarouselProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goTo = useCallback((i: number) => {
    setIndex(((i % events.length) + events.length) % events.length);
  }, [events.length]);

  const next = useCallback(() => goTo(index + 1), [goTo, index]);
  const prev = useCallback(() => goTo(index - 1), [goTo, index]);

  useEffect(() => {
    if (paused || events.length <= 1) return;
    timerRef.current = setTimeout(next, 5000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [index, paused, next, events.length]);

  if (events.length === 0) return null;

  const event = events[index];
  const multi = events.length > 1;

  return (
    <section className="mb-12">
      <h2 className="font-headline font-bold text-2xl text-on-surface mb-4 lowercase">
        this week
        <span className="chip ml-3 text-[0.6rem] uppercase tracking-wider bg-[#ffb3b5]/30 text-[#ffb3b5]">
          ★ featured
        </span>
      </h2>

      <div
        className="relative"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {/* Slide */}
        <div key={event.id} className="transition-opacity duration-300">
          <FeaturedTracker eventId={event.id}>
            <EventCard event={event} featured />
          </FeaturedTracker>
        </div>

        {/* Date chip — top-right */}
        <div className="absolute top-4 right-4 z-10 pointer-events-none">
          <span className="chip text-[0.6rem] uppercase tracking-wider">
            {formatDateShortSF(new Date(event.startDate))}
          </span>
        </div>

        {/* Prev/Next */}
        {multi && (
          <>
            <button
              onClick={prev}
              aria-label="Previous event"
              className="absolute left-3 top-1/2 -translate-y-1/2 z-10 bg-black/40 hover:bg-black/60 text-white rounded-full p-2 transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={next}
              aria-label="Next event"
              className="absolute right-3 top-1/2 -translate-y-1/2 z-10 bg-black/40 hover:bg-black/60 text-white rounded-full p-2 transition-colors"
            >
              <ChevronRight size={18} />
            </button>
          </>
        )}

        {/* Dot indicators */}
        {multi && (
          <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-10 flex gap-1.5">
            {events.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                aria-label={`Go to slide ${i + 1}`}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  i === index ? "bg-white" : "bg-white/40"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
