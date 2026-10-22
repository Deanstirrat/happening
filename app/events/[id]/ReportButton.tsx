"use client";

import { Flag, X, Check, Loader2, Pencil } from "lucide-react";
import { useState } from "react";

// Snapshot of the event's current editable values, used to prefill the
// "suggest a fix" fields and to diff against on submit (#215).
export interface EventSnapshot {
  startDate: string; // ISO
  endDate: string | null; // ISO
  allDay: boolean;
  venueName: string | null;
  price: string | null;
  imageUrl: string | null;
  description: string | null;
}

// datetime-local <-> ISO helpers (same approach as the admin EventEditPanel).
function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function datetimeLocalToISO(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const fieldCls =
  "bg-surface-container rounded-lg px-3 py-2 text-sm font-body text-on-surface placeholder:text-on-surface-variant outline-none focus:ring-1 focus:ring-primary";
const labelCls =
  "font-body text-[10px] text-on-surface-variant uppercase tracking-wider mb-1";

export default function ReportButton({
  eventId,
  event,
}: {
  eventId: string;
  event: EventSnapshot;
}) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  // Structured "suggest a fix" state (#215).
  const [showFix, setShowFix] = useState(false);
  const [isOrganizer, setIsOrganizer] = useState(false);
  const original = {
    startDate: toDatetimeLocal(event.startDate),
    endDate: toDatetimeLocal(event.endDate),
    allDay: event.allDay,
    venueName: event.venueName ?? "",
    price: event.price ?? "",
    imageUrl: event.imageUrl ?? "",
    description: event.description ?? "",
  };
  const [fix, setFix] = useState(original);
  const setFixField = <K extends keyof typeof fix>(key: K, value: (typeof fix)[K]) =>
    setFix((s) => ({ ...s, [key]: value }));

  // Collect only the fields the user actually changed, keyed like Event columns.
  function buildSuggestedEdits(): Record<string, unknown> | null {
    const edits: Record<string, unknown> = {};
    if (fix.startDate !== original.startDate) edits.startDate = datetimeLocalToISO(fix.startDate);
    if (fix.endDate !== original.endDate) edits.endDate = datetimeLocalToISO(fix.endDate);
    if (fix.allDay !== original.allDay) edits.allDay = fix.allDay;
    if (fix.venueName.trim() !== original.venueName.trim()) edits.venueName = fix.venueName.trim();
    if (fix.price.trim() !== original.price.trim()) edits.price = fix.price.trim();
    if (fix.imageUrl.trim() !== original.imageUrl.trim()) edits.imageUrl = fix.imageUrl.trim();
    if (fix.description.trim() !== original.description.trim())
      edits.description = fix.description.trim();
    // Drop keys that became empty-after-trim strings — nothing meaningful to send.
    for (const k of Object.keys(edits)) {
      if (edits[k] === "") delete edits[k];
    }
    return Object.keys(edits).length > 0 ? edits : null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    try {
      const suggestedEdits = showFix ? buildSuggestedEdits() : null;
      // A structured correction when the organizer changed fields; otherwise the
      // plain free-text report path (unchanged).
      const res = suggestedEdits
        ? await fetch(`/api/events/${eventId}/corrections`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ suggestedEdits, comment, email, isOrganizer }),
          })
        : await fetch(`/api/events/${eventId}/report`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ comment, email }),
          });
      if (!res.ok) throw new Error();
      setStatus("success");
    } catch {
      setStatus("error");
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-3.5 py-2 text-on-surface-variant hover:text-primary hover:border-primary transition-colors text-xs font-body font-semibold"
      >
        <Flag size={13} />
        report an issue
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4 overflow-y-auto">
      <div className="bg-surface rounded-2xl w-full max-w-md p-6 flex flex-col gap-5 my-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-headline font-bold text-lg text-on-surface lowercase">
            report an issue
          </h2>
          <button
            onClick={() => { setOpen(false); setStatus("idle"); }}
            className="text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {status === "success" ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <Check size={28} className="text-primary" />
            <p className="font-body text-sm text-on-surface">thanks for the heads up!</p>
            <button
              onClick={() => { setOpen(false); setStatus("idle"); }}
              className="btn-secondary text-xs px-4 py-2"
            >
              close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="font-body text-xs text-on-surface-variant uppercase tracking-wider">
                what&apos;s wrong? <span className="normal-case">(optional)</span>
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="wrong date, cancelled, duplicate listing…"
                rows={3}
                className="bg-surface-container rounded-lg px-3 py-2.5 text-sm font-body text-on-surface placeholder:text-on-surface-variant resize-none outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Suggest a fix (#215): structured, prefilled edits an admin can apply */}
            {!showFix ? (
              <button
                type="button"
                onClick={() => setShowFix(true)}
                className="flex items-center gap-1.5 text-primary hover:opacity-80 transition-opacity text-xs font-body w-fit"
              >
                <Pencil size={11} />
                suggest a fix to the details
              </button>
            ) : (
              <div className="flex flex-col gap-3 rounded-lg border border-outline-variant p-3">
                <p className="font-body text-[11px] text-on-surface-variant leading-relaxed">
                  edit any detail that&apos;s wrong — only your changes are sent for review.
                </p>

                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOrganizer}
                    onChange={(e) => setIsOrganizer(e.target.checked)}
                    className="w-4 h-4 accent-primary"
                  />
                  <span className="font-body text-xs text-on-surface">
                    i&apos;m the organizer of this event
                  </span>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex flex-col">
                    <span className={labelCls}>start date / time</span>
                    <input
                      type="datetime-local"
                      value={fix.startDate}
                      onChange={(e) => setFixField("startDate", e.target.value)}
                      className={fieldCls}
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className={labelCls}>end date / time</span>
                    <input
                      type="datetime-local"
                      value={fix.endDate}
                      onChange={(e) => setFixField("endDate", e.target.value)}
                      className={fieldCls}
                    />
                  </label>
                </div>

                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fix.allDay}
                    onChange={(e) => setFixField("allDay", e.target.checked)}
                    className="w-4 h-4 accent-primary"
                  />
                  <span className="font-body text-xs text-on-surface">all-day event</span>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex flex-col">
                    <span className={labelCls}>venue</span>
                    <input
                      type="text"
                      value={fix.venueName}
                      onChange={(e) => setFixField("venueName", e.target.value)}
                      placeholder="venue name"
                      className={fieldCls}
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className={labelCls}>price</span>
                    <input
                      type="text"
                      value={fix.price}
                      onChange={(e) => setFixField("price", e.target.value)}
                      placeholder="e.g. $15, Free"
                      className={fieldCls}
                    />
                  </label>
                </div>

                <label className="flex flex-col">
                  <span className={labelCls}>artwork / flyer image url</span>
                  <input
                    type="url"
                    value={fix.imageUrl}
                    onChange={(e) => setFixField("imageUrl", e.target.value)}
                    placeholder="https://…"
                    className={fieldCls}
                  />
                </label>

                <label className="flex flex-col">
                  <span className={labelCls}>description</span>
                  <textarea
                    value={fix.description}
                    onChange={(e) => setFixField("description", e.target.value)}
                    rows={3}
                    placeholder="what the event is about…"
                    className={`${fieldCls} resize-none`}
                  />
                </label>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="font-body text-xs text-on-surface-variant uppercase tracking-wider">
                email <span className="normal-case">(optional — so we can follow up)</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="bg-surface-container rounded-lg px-3 py-2.5 text-sm font-body text-on-surface placeholder:text-on-surface-variant outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {status === "error" && (
              <p className="font-body text-xs text-red-400">something went wrong — try again</p>
            )}

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => { setOpen(false); setStatus("idle"); }}
                className="btn-secondary text-xs px-4 py-2"
              >
                cancel
              </button>
              <button
                type="submit"
                disabled={status === "loading"}
                className="btn-primary text-xs px-4 py-2 flex items-center gap-2 disabled:opacity-60"
              >
                {status === "loading" && <Loader2 size={12} className="animate-spin" />}
                {showFix ? "submit" : "submit report"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
