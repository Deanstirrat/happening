"use client";

import { useEffect, useRef } from "react";

function getSessionId(): string {
  const key = "happeningSessionId";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

function track(eventId: string, type: "VIEW" | "CLICK") {
  try {
    const sessionId = getSessionId();
    fetch(`/api/events/${eventId}/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, sessionId }),
      keepalive: true,
    });
  } catch {
    // ignore
  }
}

interface FeaturedTrackerProps {
  eventId: string;
  children: React.ReactNode;
}

export default function FeaturedTracker({ eventId, children }: FeaturedTrackerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const viewed = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !viewed.current) {
          viewed.current = true;
          track(eventId, "VIEW");
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [eventId]);

  return (
    <div ref={ref} onClick={() => track(eventId, "CLICK")}>
      {children}
    </div>
  );
}
