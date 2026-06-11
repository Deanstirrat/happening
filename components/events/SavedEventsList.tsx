"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";
import type { EventSummary } from "@/lib/types";
import { getSavedEventIds, subscribeSavedEvents } from "@/lib/savedEvents";
import { EventCardGrid } from "./EventCard";

/** end (or start, if open-ended) of an event as a timestamp, for past/upcoming split. */
function eventEnd(e: EventSummary): number {
  return new Date(e.endDate ?? e.startDate).getTime();
}

export default function SavedEventsList() {
  // null = first load not yet resolved; map keyed by id so re-saving an event
  // (within the session) restores it without another fetch.
  const [eventsById, setEventsById] = useState<Record<string, EventSummary> | null>(null);
  const [savedIds, setSavedIds] = useState<string[] | null>(null);
  const [error, setError] = useState(false);
  // Guards against firing overlapping fetches for the same ids.
  const fetchingRef = useRef<Set<string>>(new Set());

  const loadIds = useCallback(async (ids: string[]) => {
    const missing = ids.filter((id) => !fetchingRef.current.has(id));
    if (missing.length === 0) return;
    missing.forEach((id) => fetchingRef.current.add(id));
    try {
      const res = await fetch(`/api/events?ids=${encodeURIComponent(missing.join(","))}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setEventsById((prev) => {
        const next = { ...(prev ?? {}) };
        for (const e of data.events as EventSummary[]) next[e.id] = e;
        return next;
      });
    } catch {
      setError(true);
      // Allow a retry on the next change rather than wedging these ids.
      missing.forEach((id) => fetchingRef.current.delete(id));
    } finally {
      // Ensure the loading state resolves even when nothing came back.
      setEventsById((prev) => prev ?? {});
    }
  }, []);

  useEffect(() => {
    const sync = () => setSavedIds(getSavedEventIds());
    sync();
    return subscribeSavedEvents(sync);
  }, []);

  // Fetch data for any saved id we don't have yet (initial load + cross-tab adds).
  useEffect(() => {
    if (savedIds === null) return;
    if (savedIds.length === 0) {
      setEventsById((prev) => prev ?? {});
      return;
    }
    const haveIds = new Set(Object.keys(eventsById ?? {}));
    const missing = savedIds.filter((id) => !haveIds.has(id));
    if (missing.length > 0) loadIds(missing);
  }, [savedIds, eventsById, loadIds]);

  // Still resolving localStorage / first fetch.
  if (savedIds === null || eventsById === null) {
    return (
      <>
        <Header count={null} />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="aspect-[4/3] rounded-DEFAULT bg-surface-container animate-pulse" />
          ))}
        </div>
      </>
    );
  }

  if (savedIds.length === 0) {
    return (
      <>
        <Header count={0} />
        <EmptySaved />
      </>
    );
  }

  // Preserve the saved set's membership; drop ids that no longer resolve to a
  // published event (deleted/unpublished). Split into upcoming vs. past.
  const resolved = savedIds.map((id) => eventsById[id]).filter(Boolean) as EventSummary[];
  const now = Date.now();
  const upcoming = resolved.filter((e) => eventEnd(e) >= now).sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  );
  const past = resolved.filter((e) => eventEnd(e) < now).sort(
    (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
  );

  return (
    <>
      <Header count={resolved.length} />

      {error && resolved.length === 0 && (
        <p className="font-body text-sm text-on-surface-variant mb-6">
          couldn&rsquo;t load your saved events. try refreshing.
        </p>
      )}

      {resolved.length === 0 ? (
        <EmptySaved />
      ) : (
        <>
          {upcoming.length > 0 && <Grid events={upcoming} />}

          {past.length > 0 && (
            <section className="mt-12">
              <h2 className="font-headline font-bold text-xl text-on-surface lowercase mb-4 opacity-70">
                past
              </h2>
              <div className="opacity-60">
                <Grid events={past} />
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

function Grid({ events }: { events: EventSummary[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {events.map((e) => (
        <div key={e.id} className="reveal-scroll">
          <EventCardGrid event={e} />
        </div>
      ))}
    </div>
  );
}

function Header({ count }: { count: number | null }) {
  return (
    <div className="mb-8">
      <h1 className="font-headline font-black text-4xl sm:text-5xl text-on-surface lowercase leading-none flex items-center gap-3">
        saved
        <Heart size={28} className="text-primary shrink-0" fill="currentColor" />
      </h1>
      <p className="font-body text-on-surface-variant text-sm mt-2">
        {count === null
          ? " "
          : count > 0
          ? `${count} event${count !== 1 ? "s" : ""} you've hearted`
          : "events you heart land here"}
      </p>
    </div>
  );
}

function EmptySaved() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-6 text-center">
      <div className="relative">
        <Heart size={72} className="text-primary/15" fill="currentColor" />
        <Heart
          size={72}
          className="absolute inset-0 text-primary/40"
          strokeWidth={1.25}
        />
      </div>
      <div>
        <h3 className="font-headline font-bold text-xl text-on-surface lowercase">
          nothing saved yet
        </h3>
        <p className="font-body text-sm text-on-surface-variant mt-2 max-w-sm">
          tap the <span className="text-primary">heart</span> on any event and it&rsquo;ll
          show up here &mdash; no account needed.
        </p>
      </div>
      <Link href="/" className="btn-secondary px-5 py-2.5 text-sm">
        browse events
      </Link>
    </div>
  );
}
