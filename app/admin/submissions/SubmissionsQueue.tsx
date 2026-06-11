"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { CATEGORY_LABELS, type EventCategory } from "@/lib/types";
import AdminActions from "./AdminActions";
import SubmissionImageEdit from "./SubmissionImageEdit";

// Shape passed down from the server component (page.tsx). Dates survive the RSC
// boundary as Date instances, so no re-parsing is needed here.
export type PendingEvent = {
  id: string;
  title: string;
  startDate: Date;
  venueName: string | null;
  venueAddress: string | null;
  neighborhood: string | null;
  category: EventCategory | null;
  price: string | null;
  isFree: boolean;
  description: string | null;
  sourceUrl: string;
  tags: string[];
  submitterNote: string | null;
  scrapedAt: Date;
  imageUrl: string | null;
};

type BulkAction = "approve" | "reject" | "feature" | "delete";

export default function SubmissionsQueue({ events }: { events: PendingEvent[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // Anchor for shift-click range selection.
  const lastClicked = useRef<string | null>(null);

  // A single-row action can refresh the list and drop an event that's still in
  // `selected`. Rather than prune state in an effect (which triggers cascading
  // renders), derive the live selection at render time — stale ids are simply
  // ignored everywhere they matter (count, bulk payload, select-all math).
  const selectedLive = useMemo(() => {
    const live = new Set(events.map((e) => e.id));
    return [...selected].filter((id) => live.has(id));
  }, [events, selected]);

  const selectedCount = selectedLive.length;
  const allSelected = events.length > 0 && selectedCount === events.length;
  const someSelected = selectedCount > 0;

  const clear = useCallback(() => setSelected(new Set()), []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const ids = events.map((e) => e.id);
      const allOn = ids.length > 0 && ids.every((id) => prev.has(id));
      return allOn ? new Set() : new Set(ids);
    });
  }, [events]);

  const toggleOne = useCallback(
    (id: string, shiftKey: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        // Shift-click selects the contiguous range from the last-clicked row.
        if (shiftKey && lastClicked.current) {
          const ids = events.map((e) => e.id);
          const from = ids.indexOf(lastClicked.current);
          const to = ids.indexOf(id);
          if (from !== -1 && to !== -1) {
            const [lo, hi] = from < to ? [from, to] : [to, from];
            for (let i = lo; i <= hi; i++) next.add(ids[i]);
            lastClicked.current = id;
            return next;
          }
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        lastClicked.current = id;
        return next;
      });
    },
    [events]
  );

  const runBulk = useCallback(
    async (action: BulkAction) => {
      const ids = selectedLive;
      if (ids.length === 0 || busy) return;
      if (
        action === "delete" &&
        !window.confirm(
          `Delete ${ids.length} event${ids.length !== 1 ? "s" : ""}? This cannot be undone.`
        )
      ) {
        return;
      }
      setBusy(true);
      await fetch("/api/admin/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action }),
      });
      setSelected(new Set());
      router.refresh();
      setBusy(false);
    },
    [selectedLive, busy, router]
  );

  // Keyboard-friendly flow: with a selection active, single keys fire the bulk
  // actions (a/r/f, Delete/Backspace), Escape clears, and Cmd/Ctrl+A selects all.
  // Ignored while typing in a field so it never hijacks the image-url input etc.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      ) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        if (events.length === 0) return;
        e.preventDefault();
        toggleAll();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "Escape" && someSelected) {
        clear();
        return;
      }
      if (!someSelected) return;

      switch (e.key.toLowerCase()) {
        case "a":
          e.preventDefault();
          runBulk("approve");
          break;
        case "r":
          e.preventDefault();
          runBulk("reject");
          break;
        case "f":
          e.preventDefault();
          runBulk("feature");
          break;
        case "delete":
        case "backspace":
          e.preventDefault();
          runBulk("delete");
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [events.length, someSelected, toggleAll, clear, runBulk]);

  if (events.length === 0) {
    return <p className="font-body text-on-surface-variant">Nothing to review.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Select-all header */}
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected && !allSelected;
            }}
            onChange={toggleAll}
            className="size-4 accent-primary cursor-pointer"
          />
          <span className="font-body text-sm text-on-surface-variant">
            {someSelected ? `${selectedCount} selected` : "select all"}
          </span>
        </label>
        {someSelected && (
          <button
            onClick={clear}
            className="font-body text-xs text-on-surface-variant hover:text-on-surface underline"
          >
            clear
          </button>
        )}
        <span className="font-body text-xs text-on-surface-variant ml-auto hidden sm:block">
          shortcuts: a approve · r reject · f feature · ⌫ delete · esc clear
        </span>
      </div>

      {events.map((event) => {
        const isSelected = selected.has(event.id);
        return (
          <div
            key={event.id}
            className={`bg-surface-container rounded-2xl p-5 flex flex-col gap-3 transition-shadow ${
              isSelected ? "ring-2 ring-primary" : ""
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={isSelected}
                onClick={(e) => toggleOne(event.id, e.shiftKey)}
                onChange={() => {}}
                aria-label={`Select ${event.title}`}
                className="size-4 mt-1.5 accent-primary cursor-pointer shrink-0"
              />
              <div className="flex items-start justify-between gap-4 flex-1 min-w-0">
                <div className="flex-1 min-w-0">
                  <h2 className="font-headline font-bold text-lg text-on-surface leading-tight">
                    {event.title}
                  </h2>
                  <p className="font-body text-on-surface-variant text-sm mt-0.5">
                    {format(event.startDate, "EEE, MMM d yyyy")}
                    {event.venueName && ` · ${event.venueName}`}
                    {event.neighborhood && ` · ${event.neighborhood}`}
                  </p>
                </div>
                {event.category && (
                  <span className="chip shrink-0 text-xs">
                    {CATEGORY_LABELS[event.category] ?? event.category}
                  </span>
                )}
              </div>
            </div>

            {event.description && (
              <p className="font-body text-on-surface text-sm">{event.description}</p>
            )}

            <div className="flex flex-wrap gap-2 text-xs font-body text-on-surface-variant">
              {event.price && <span>{event.price}</span>}
              {event.isFree && <span>Free</span>}
              {event.venueAddress && <span>{event.venueAddress}</span>}
              {event.tags.map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
            </div>

            {event.submitterNote && (
              <p className="font-body text-on-surface-variant text-xs italic">
                Note: {event.submitterNote}
              </p>
            )}

            <SubmissionImageEdit id={event.id} imageUrl={event.imageUrl} />

            <div className="flex items-center gap-3 mt-1">
              <a
                href={event.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-body text-xs text-on-surface-variant hover:text-on-surface underline truncate max-w-xs"
              >
                {event.sourceUrl}
              </a>
              <span className="font-body text-xs text-on-surface-variant ml-auto">
                submitted {format(event.scrapedAt, "MMM d h:mma")}
              </span>
            </div>

            <AdminActions id={event.id} />
          </div>
        );
      })}

      {/* Sticky bulk-action bar — only while a selection exists. */}
      {someSelected && (
        <div className="sticky bottom-4 z-10 mx-auto flex flex-wrap items-center gap-2 rounded-full bg-surface-container-high shadow-lg px-4 py-2.5 ring-1 ring-on-surface/10">
          <span className="font-body text-sm font-semibold text-on-surface px-1">
            {selectedCount} selected
          </span>
          <button
            onClick={() => runBulk("approve")}
            disabled={busy}
            className="font-body text-sm font-semibold px-4 py-1.5 rounded-full bg-[#4ade80]/20 text-[#4ade80] hover:bg-[#4ade80]/30 transition-colors disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={() => runBulk("feature")}
            disabled={busy}
            className="font-body text-sm font-semibold px-4 py-1.5 rounded-full bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50"
          >
            ★ Feature
          </button>
          <button
            onClick={() => runBulk("reject")}
            disabled={busy}
            className="font-body text-sm font-semibold px-4 py-1.5 rounded-full bg-surface-container-low text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-50"
          >
            Reject
          </button>
          <button
            onClick={() => runBulk("delete")}
            disabled={busy}
            className="font-body text-sm font-semibold px-4 py-1.5 rounded-full bg-[#ef4444]/15 text-[#ef4444] hover:bg-[#ef4444]/25 transition-colors disabled:opacity-50"
          >
            Delete
          </button>
          <button
            onClick={clear}
            disabled={busy}
            className="font-body text-sm px-3 py-1.5 rounded-full text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
