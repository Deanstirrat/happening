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
  const touchStartX = useRef<number | null>(null);

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

  const multi = events.length > 1;

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) {
      diff > 0 ? next() : prev();
    }
    touchStartX.current = null;
  };

  return (
    <section>
      <div
        className="overflow-hidden"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Sliding strip */}
        <div
          className="flex transition-transform duration-500 ease-in-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {events.map((event) => (
            <div key={event.id} className="w-full shrink-0">
              <FeaturedTracker eventId={event.id}>
                <EventCard event={event} featured />
              </FeaturedTracker>
            </div>
          ))}
        </div>
      </div>

      {/* Dot indicators — outside card, below date */}
      {multi && (
        <div className="mt-3 flex gap-1.5 items-center justify-center">
          {events.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={`Go to slide ${i + 1}`}
              className="rounded-full transition-all duration-300"
              style={
                i === index
                  ? { width: "1rem", height: "0.375rem", background: "linear-gradient(135deg, #ffb3b5, #ff727c)" }
                  : { width: "0.375rem", height: "0.375rem", background: "rgba(255,255,255,0.3)" }
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
