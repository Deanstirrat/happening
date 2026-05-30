"use client";

import { useState } from "react";
import { Pencil, X, Check, Loader2 } from "lucide-react";
import type { Event } from "@prisma/client";

type EditableFields = {
  title: string;
  description: string;
  imageUrl: string;
  startDate: string;
  endDate: string;
  venueName: string;
  venueAddress: string;
  neighborhood: string;
  price: string;
  isFree: boolean;
};

function toDatetimeLocal(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  // Format as YYYY-MM-DDTHH:mm for datetime-local input
  return date.toISOString().slice(0, 16);
}

export default function EventEditPanel({ event }: { event: Event }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const [fields, setFields] = useState<EditableFields>({
    title: event.title ?? "",
    description: event.description ?? "",
    imageUrl: event.imageUrl ?? "",
    startDate: toDatetimeLocal(event.startDate),
    endDate: toDatetimeLocal(event.endDate),
    venueName: event.venueName ?? "",
    venueAddress: event.venueAddress ?? "",
    neighborhood: event.neighborhood ?? "",
    price: event.price ?? "",
    isFree: event.isFree,
  });

  function set<K extends keyof EditableFields>(key: K, value: EditableFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setStatus("saving");
    setErrorMsg("");

    const body: Record<string, unknown> = {
      title: fields.title || null,
      description: fields.description || null,
      imageUrl: fields.imageUrl || null,
      startDate: fields.startDate || null,
      endDate: fields.endDate || null,
      venueName: fields.venueName || null,
      venueAddress: fields.venueAddress || null,
      neighborhood: fields.neighborhood || null,
      price: fields.price || null,
      isFree: fields.isFree,
    };

    const res = await fetch(`/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2500);
    } else {
      const data = await res.json().catch(() => ({}));
      setErrorMsg(data.error ?? "Failed to save.");
      setStatus("error");
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
        <div className="bg-surface-container rounded-xl px-4 py-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="font-body text-xs text-on-surface-variant uppercase tracking-widest">
              Edit event
            </span>
            <button onClick={() => setOpen(false)} className="text-on-surface-variant hover:text-on-surface">
              <X size={15} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="font-body text-[10px] text-on-surface-variant uppercase tracking-wider">Title</span>
              <input
                type="text"
                value={fields.title}
                onChange={(e) => set("title", e.target.value)}
                className="bg-surface-container-high rounded-lg px-3 py-2 text-sm font-body text-on-surface outline-none focus:ring-2 focus:ring-primary"
              />
            </label>

            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="font-body text-[10px] text-on-surface-variant uppercase tracking-wider">Image URL</span>
              <input
                type="url"
                value={fields.imageUrl}
                onChange={(e) => set("imageUrl", e.target.value)}
                placeholder="https://..."
                className="bg-surface-container-high rounded-lg px-3 py-2 text-sm font-body text-on-surface outline-none focus:ring-2 focus:ring-primary"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-body text-[10px] text-on-surface-variant uppercase tracking-wider">Start date / time</span>
              <input
                type="datetime-local"
                value={fields.startDate}
                onChange={(e) => set("startDate", e.target.value)}
                className="bg-surface-container-high rounded-lg px-3 py-2 text-sm font-body text-on-surface outline-none focus:ring-2 focus:ring-primary"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-body text-[10px] text-on-surface-variant uppercase tracking-wider">End date / time</span>
              <input
                type="datetime-local"
                value={fields.endDate}
                onChange={(e) => set("endDate", e.target.value)}
                className="bg-surface-container-high rounded-lg px-3 py-2 text-sm font-body text-on-surface outline-none focus:ring-2 focus:ring-primary"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-body text-[10px] text-on-surface-variant uppercase tracking-wider">Venue name</span>
              <input
                type="text"
                value={fields.venueName}
                onChange={(e) => set("venueName", e.target.value)}
                className="bg-surface-container-high rounded-lg px-3 py-2 text-sm font-body text-on-surface outline-none focus:ring-2 focus:ring-primary"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-body text-[10px] text-on-surface-variant uppercase tracking-wider">Neighborhood</span>
              <input
                type="text"
                value={fields.neighborhood}
                onChange={(e) => set("neighborhood", e.target.value)}
                className="bg-surface-container-high rounded-lg px-3 py-2 text-sm font-body text-on-surface outline-none focus:ring-2 focus:ring-primary"
              />
            </label>

            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="font-body text-[10px] text-on-surface-variant uppercase tracking-wider">Venue address</span>
              <input
                type="text"
                value={fields.venueAddress}
                onChange={(e) => set("venueAddress", e.target.value)}
                className="bg-surface-container-high rounded-lg px-3 py-2 text-sm font-body text-on-surface outline-none focus:ring-2 focus:ring-primary"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-body text-[10px] text-on-surface-variant uppercase tracking-wider">Price</span>
              <input
                type="text"
                value={fields.price}
                onChange={(e) => set("price", e.target.value)}
                placeholder="e.g. $15"
                className="bg-surface-container-high rounded-lg px-3 py-2 text-sm font-body text-on-surface outline-none focus:ring-2 focus:ring-primary"
              />
            </label>

            <label className="flex items-center gap-3 cursor-pointer pt-5">
              <input
                type="checkbox"
                checked={fields.isFree}
                onChange={(e) => set("isFree", e.target.checked)}
                className="w-4 h-4 accent-primary"
              />
              <span className="font-body text-sm text-on-surface">Free event</span>
            </label>

            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="font-body text-[10px] text-on-surface-variant uppercase tracking-wider">Description</span>
              <textarea
                value={fields.description}
                onChange={(e) => set("description", e.target.value)}
                rows={4}
                className="bg-surface-container-high rounded-lg px-3 py-2 text-sm font-body text-on-surface outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </label>
          </div>

          {status === "error" && (
            <p className="text-xs font-body text-red-400">{errorMsg}</p>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={status === "saving"}
              className="btn-primary py-2 px-5 text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {status === "saving" ? (
                <><Loader2 size={13} className="animate-spin" /> saving…</>
              ) : status === "saved" ? (
                <><Check size={13} /> saved</>
              ) : (
                "save changes"
              )}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="font-body text-xs text-on-surface-variant hover:text-on-surface transition-colors"
            >
              cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
