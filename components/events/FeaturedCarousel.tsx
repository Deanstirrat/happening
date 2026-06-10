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
        className="overflow-hidden relative"
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

        {/* Arrow buttons */}
        {multi && (
          <>
            <button
              onClick={prev}
              aria-label="Previous event"
              className="hidden sm:flex absolute left-0 top-0 h-full w-16 items-center justify-start pl-3 opacity-0 hover:opacity-100 transition-opacity duration-300 group"
              style={{ background: "linear-gradient(to right, rgba(0,0,0,0.35) 0%, transparent 100%)" }}
            >
              <svg
                width="28" height="28" viewBox="0 0 24 24" fill="none"
                className="text-white drop-shadow-lg group-hover:scale-110 transition-transform duration-200"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              onClick={next}
              aria-label="Next event"
              className="hidden sm:flex absolute right-0 top-0 h-full w-16 items-center justify-end pr-3 opacity-0 hover:opacity-100 transition-opacity duration-300 group"
              style={{ background: "linear-gradient(to left, rgba(0,0,0,0.35) 0%, transparent 100%)" }}
            >
              <svg
                width="28" height="28" viewBox="0 0 24 24" fill="none"
                className="text-white drop-shadow-lg group-hover:scale-110 transition-transform duration-200"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </>
        )}

        {/* Dot indicators — inside card at bottom */}
        {multi && (
          <div className="absolute bottom-3 left-0 right-0 flex gap-1.5 items-center justify-center pointer-events-none">
            {events.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                aria-label={`Go to slide ${i + 1}`}
                className="rounded-full transition-all duration-300 pointer-events-auto"
                style={
                  i === index
                    ? { width: "1rem", height: "0.375rem", background: "linear-gradient(135deg, #ff3b30, #ff0000)" }
                    : { width: "0.375rem", height: "0.375rem", background: "rgba(255,255,255,0.3)" }
                }
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
