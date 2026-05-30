"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X, Check, Loader2, Trash2, AlertTriangle } from "lucide-react";
import type { Event } from "@prisma/client";
import { CATEGORY_LABELS } from "@/lib/types";

const EVENT_STATUSES = ["PENDING", "PUBLISHED", "REJECTED", "ARCHIVED"] as const;
const RECURRING_TYPES = ["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY", "ANNUAL"] as const;
const CATEGORIES = Object.keys(CATEGORY_LABELS) as (keyof typeof CATEGORY_LABELS)[];

type Fields = {
  title: string;
  description: string;
  imageUrl: string;
  sourceUrl: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  venueName: string;
  venueAddress: string;
  city: string;
  neighborhood: string;
  category: string;
  price: string;
  isFree: boolean;
  tags: string;
  performers: string;
  status: string;
  recurringType: string;
};

function toDatetimeLocal(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 16);
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-body text-[10px] text-on-surface-variant uppercase tracking-wider mb-1">
      {children}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <Label>{label}</Label>
      {children}
    </label>
  );
}

const inputCls = "bg-surface-container-high rounded-lg px-3 py-2 text-sm font-body text-on-surface outline-none focus:ring-2 focus:ring-primary";
const selectCls = `${inputCls} cursor-pointer`;

export default function EventEditPanel({ event }: { event: Event }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [deleteState, setDeleteState] = useState<"idle" | "confirming" | "deleting">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const [fields, setFields] = useState<Fields>({
    title: event.title ?? "",
    description: event.description ?? "",
    imageUrl: event.imageUrl ?? "",
    sourceUrl: event.sourceUrl ?? "",
    startDate: toDatetimeLocal(event.startDate),
    endDate: toDatetimeLocal(event.endDate),
    allDay: event.allDay,
    venueName: event.venueName ?? "",
    venueAddress: event.venueAddress ?? "",
    city: event.city ?? "",
    neighborhood: event.neighborhood ?? "",
    category: event.category ?? "",
    price: event.price ?? "",
    isFree: event.isFree,
    tags: event.tags.join(", "),
    performers: event.performers.join(", "),
    status: event.status,
    recurringType: event.recurringType ?? "",
  });

  function set<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaveStatus("saving");
    setErrorMsg("");

    const res = await fetch(`/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...fields,
        startDate: fields.startDate || null,
        endDate: fields.endDate || null,
        imageUrl: fields.imageUrl || null,
        description: fields.description || null,
        venueName: fields.venueName || null,
        venueAddress: fields.venueAddress || null,
        neighborhood: fields.neighborhood || null,
        price: fields.price || null,
        category: fields.category || null,
        recurringType: fields.recurringType || null,
        tags: fields.tags.split(",").map((t) => t.trim()).filter(Boolean),
        performers: fields.performers.split(",").map((p) => p.trim()).filter(Boolean),
      }),
    });

    if (res.ok) {
      setSaveStatus("saved");
      router.refresh();
      setTimeout(() => setSaveStatus("idle"), 2500);
    } else {
      const data = await res.json().catch(() => ({}));
      setErrorMsg(data.error ?? "Failed to save.");
      setSaveStatus("error");
    }
  }

  async function handleDelete() {
    setDeleteState("deleting");
    const res = await fetch(`/api/events/${event.id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/events");
    } else {
      setDeleteState("idle");
      setErrorMsg("Failed to delete event.");
    }
  }

  return (
    <div className="mb-4">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 bg-surface-container-high hover:bg-surface-container rounded-xl px-4 py-3 font-body text-xs text-on-surface-variant hover:text-on-surface transition-colors w-full"
        >
          <Pencil size={13} />
          Edit this event
        </button>
      ) : (
        <div className="bg-surface-container rounded-xl px-4 py-4 flex flex-col gap-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <span className="font-body text-xs text-on-surface-variant uppercase tracking-widest">Edit event</span>
            <button onClick={() => setOpen(false)} className="text-on-surface-variant hover:text-on-surface">
              <X size={15} />
            </button>
          </div>

          {/* Status & category */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Status">
              <select value={fields.status} onChange={(e) => set("status", e.target.value)} className={selectCls}>
                {EVENT_STATUSES.map((s) => (
                  <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
                ))}
              </select>
            </Field>

            <Field label="Category">
              <select value={fields.category} onChange={(e) => set("category", e.target.value)} className={selectCls}>
                <option value="">— none —</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* Title & source URL */}
          <div className="grid grid-cols-1 gap-3">
            <Field label="Title">
              <input type="text" value={fields.title} onChange={(e) => set("title", e.target.value)} className={inputCls} />
            </Field>

            <Field label="Source URL">
              <input type="url" value={fields.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} placeholder="https://..." className={inputCls} />
            </Field>

            <Field label="Image URL">
              <input type="url" value={fields.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} placeholder="https://..." className={inputCls} />
            </Field>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Start date / time">
              <input type="datetime-local" value={fields.startDate} onChange={(e) => set("startDate", e.target.value)} className={inputCls} />
            </Field>
            <Field label="End date / time">
              <input type="datetime-local" value={fields.endDate} onChange={(e) => set("endDate", e.target.value)} className={inputCls} />
            </Field>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={fields.allDay} onChange={(e) => set("allDay", e.target.checked)} className="w-4 h-4 accent-primary" />
              <span className="font-body text-sm text-on-surface">All day event</span>
            </label>
            <Field label="Recurring">
              <select value={fields.recurringType} onChange={(e) => set("recurringType", e.target.value)} className={selectCls}>
                <option value="">— not recurring —</option>
                {RECURRING_TYPES.map((r) => (
                  <option key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* Venue */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Venue name">
              <input type="text" value={fields.venueName} onChange={(e) => set("venueName", e.target.value)} className={inputCls} />
            </Field>
            <Field label="Neighborhood">
              <input type="text" value={fields.neighborhood} onChange={(e) => set("neighborhood", e.target.value)} className={inputCls} />
            </Field>
            <Field label="Venue address">
              <input type="text" value={fields.venueAddress} onChange={(e) => set("venueAddress", e.target.value)} className={inputCls} />
            </Field>
            <Field label="City">
              <input type="text" value={fields.city} onChange={(e) => set("city", e.target.value)} className={inputCls} />
            </Field>
          </div>

          {/* Price */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Price">
              <input type="text" value={fields.price} onChange={(e) => set("price", e.target.value)} placeholder="e.g. $15" className={inputCls} />
            </Field>
            <label className="flex items-center gap-3 cursor-pointer pt-5">
              <input type="checkbox" checked={fields.isFree} onChange={(e) => set("isFree", e.target.checked)} className="w-4 h-4 accent-primary" />
              <span className="font-body text-sm text-on-surface">Free event</span>
            </label>
          </div>

          {/* Tags & performers */}
          <div className="grid grid-cols-1 gap-3">
            <Field label="Tags (comma-separated)">
              <input type="text" value={fields.tags} onChange={(e) => set("tags", e.target.value)} placeholder="jazz, outdoor, free..." className={inputCls} />
            </Field>
            <Field label="Performers (comma-separated)">
              <input type="text" value={fields.performers} onChange={(e) => set("performers", e.target.value)} placeholder="Artist One, Artist Two..." className={inputCls} />
            </Field>
          </div>

          {/* Description */}
          <Field label="Description">
            <textarea value={fields.description} onChange={(e) => set("description", e.target.value)} rows={4} className={`${inputCls} resize-none`} />
          </Field>

          {saveStatus === "error" && (
            <p className="text-xs font-body text-red-400">{errorMsg}</p>
          )}

          {/* Save */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saveStatus === "saving"}
              className="btn-primary py-2 px-5 text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {saveStatus === "saving" ? (
                <><Loader2 size={13} className="animate-spin" />saving…</>
              ) : saveStatus === "saved" ? (
                <><Check size={13} />saved</>
              ) : (
                "save changes"
              )}
            </button>
            <button onClick={() => setOpen(false)} className="font-body text-xs text-on-surface-variant hover:text-on-surface transition-colors">
              cancel
            </button>
          </div>

          {/* Delete */}
          <div className="border-t border-outline-variant pt-4">
            {deleteState === "idle" && (
              <button
                onClick={() => setDeleteState("confirming")}
                className="flex items-center gap-2 font-body text-xs text-on-surface-variant hover:text-red-400 transition-colors"
              >
                <Trash2 size={13} />
                Delete this event
              </button>
            )}

            {deleteState === "confirming" && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 flex flex-col gap-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" />
                  <p className="font-body text-xs text-on-surface leading-relaxed">
                    This will permanently delete <strong>{event.title}</strong> and cannot be undone.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleDelete}
                    className="bg-red-500 hover:bg-red-600 text-white font-body text-xs font-semibold px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <Trash2 size={12} />
                    Yes, delete it
                  </button>
                  <button
                    onClick={() => setDeleteState("idle")}
                    className="font-body text-xs text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    cancel
                  </button>
                </div>
              </div>
            )}

            {deleteState === "deleting" && (
              <div className="flex items-center gap-2 font-body text-xs text-on-surface-variant">
                <Loader2 size={13} className="animate-spin" />
                Deleting…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
