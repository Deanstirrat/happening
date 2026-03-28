"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { EventSummary } from "@/lib/types";
import EventCard from "./EventCard";
import FeaturedTracker from "./FeaturedTracker";

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
    <section>
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

        {/* Dot indicators */}
        {multi && (
          <div className="absolute bottom-2 sm:bottom-14 left-1/2 -translate-x-1/2 z-10 flex gap-1.5 items-center">
            {events.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                aria-label={`Go to slide ${i + 1}`}
                className="rounded-full transition-all duration-300"
                style={
                  i === index
                    ? { width: "1rem", height: "0.375rem", background: "linear-gradient(135deg, #ffb3b5, #ff727c)" }
                    : { width: "0.375rem", height: "0.375rem", background: "rgba(255,255,255,0.4)" }
                }
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
