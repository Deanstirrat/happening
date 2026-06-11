"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SF_NEIGHBORHOODS, CATEGORY_LABELS } from "@/lib/types";
import { EventCategory, EventStatus, RecurringType } from "@prisma/client";
import { formatDatetimeLocalSF, sfDateFromLocal } from "@/lib/sfDate";

interface EventData {
  id: string;
  title: string;
  description: string | null;
  startDate: Date;
  endDate: Date | null;
  allDay: boolean;
  venueName: string | null;
  venueAddress: string | null;
  neighborhood: string | null;
  category: EventCategory | null;
  price: string | null;
  isFree: boolean;
  tags: string[];
  sourceUrl: string;
  imageUrl: string | null;
  status: EventStatus;
  recurringType: RecurringType | null;
}

function toDatetimeLocal(date: Date | null): string {
  if (!date) return "";
  return formatDatetimeLocalSF(date);
}

function toDateOnly(date: Date | null): string {
  if (!date) return "";
  // Returns YYYY-MM-DD in SF timezone
  return formatDatetimeLocalSF(date).slice(0, 10);
}

function sfIsoFromDatetimeLocal(localStr: string): string {
  // Interpret a datetime-local value ("2026-03-27T20:00") as SF local time
  const m = localStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return new Date(localStr).toISOString();
  return sfDateFromLocal(+m[1], +m[2], +m[3], +m[4], +m[5]).toISOString();
}

function sfIsoFromDateOnly(dateStr: string): string {
  // Interpret a YYYY-MM-DD value as noon SF time (avoids UTC day-boundary issues)
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date(dateStr).toISOString();
  return sfDateFromLocal(+m[1], +m[2], +m[3], 12, 0).toISOString();
}

export default function EditEventForm({ event }: { event: EventData }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description ?? "");
  const [allDay, setAllDay] = useState(event.allDay);
  const [startDate, setStartDate] = useState(toDatetimeLocal(event.startDate));
  const [endDate, setEndDate] = useState(toDatetimeLocal(event.endDate));
  const [venueName, setVenueName] = useState(event.venueName ?? "");
  const [venueAddress, setVenueAddress] = useState(event.venueAddress ?? "");
  const [neighborhood, setNeighborhood] = useState(event.neighborhood ?? "");
  const [category, setCategory] = useState<string>(event.category ?? "");
  const [price, setPrice] = useState(event.price ?? "");
  const [isFree, setIsFree] = useState(event.isFree);
  const [tags, setTags] = useState(event.tags.join(", "));
  const [sourceUrl, setSourceUrl] = useState(event.sourceUrl);
  const [imageUrl, setImageUrl] = useState(event.imageUrl ?? "");
  const [status, setStatus] = useState<EventStatus>(event.status);
  const [recurringType, setRecurringType] = useState<string>(event.recurringType ?? "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const res = await fetch(`/api/admin/events/${event.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        description: description || null,
        allDay,
        startDate: allDay ? sfIsoFromDateOnly(startDate) : sfIsoFromDatetimeLocal(startDate),
        endDate: endDate ? (allDay ? sfIsoFromDateOnly(endDate) : sfIsoFromDatetimeLocal(endDate)) : null,
        venueName: venueName || null,
        venueAddress: venueAddress || null,
        neighborhood: neighborhood || null,
        category: category || null,
        price: price || null,
        isFree,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        sourceUrl,
        imageUrl: imageUrl || null,
        status,
        recurringType: recurringType || null,
      }),
    });

    if (!res.ok) {
      setError("Failed to save. Please try again.");
      setSaving(false);
      return;
    }

    router.push(`/admin/events`);
  }

  const inputClass =
    "w-full font-body text-sm text-on-surface bg-surface-container rounded-xl px-4 py-2.5 border border-transparent focus:border-on-surface-variant focus:outline-none transition-colors";
  const labelClass = "block font-body text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {error && (
        <p className="font-body text-sm text-[#ef4444]">{error}</p>
      )}

      <div>
        <label className={labelClass}>Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          className={inputClass}
        />
      </div>

      <div className="flex items-center gap-2 -mb-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => {
              const next = e.target.checked;
              setAllDay(next);
              // Convert datetime-local ↔ date-only values when toggling
              if (next) {
                setStartDate((v) => v.slice(0, 10));
                setEndDate((v) => v.slice(0, 10));
              } else {
                setStartDate((v) => v.length === 10 ? `${v}T12:00` : v);
                setEndDate((v) => v.length === 10 ? `${v}T12:00` : v);
              }
            }}
            className="w-4 h-4 accent-[#4ade80]"
          />
          <span className="font-body text-sm text-on-surface">All day event</span>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Start {allDay ? "Date" : "Date & Time"}</label>
          <input
            type={allDay ? "date" : "datetime-local"}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>End {allDay ? "Date" : "Date & Time"}</label>
          <input
            type={allDay ? "date" : "datetime-local"}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Venue Name</label>
          <input
            type="text"
            value={venueName}
            onChange={(e) => setVenueName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Venue Address</label>
          <input
            type="text"
            value={venueAddress}
            onChange={(e) => setVenueAddress(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Neighborhood</label>
          <select
            value={neighborhood}
            onChange={(e) => setNeighborhood(e.target.value)}
            className={inputClass}
          >
            <option value="">— none —</option>
            {SF_NEIGHBORHOODS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputClass}
          >
            <option value="">— none —</option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Price</label>
          <input
            type="text"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="e.g. $15–$25"
            className={inputClass}
          />
        </div>
        <div className="flex items-end pb-2.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isFree}
              onChange={(e) => setIsFree(e.target.checked)}
              className="w-4 h-4 accent-[#4ade80]"
            />
            <span className="font-body text-sm text-on-surface">Free event</span>
          </label>
        </div>
      </div>

      <div>
        <label className={labelClass}>Tags (comma-separated)</label>
        <input
          type="text"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="e.g. live music, outdoor, 21+"
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>Source URL</label>
        <input
          type="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          required
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>Image URL</label>
        <input
          type="url"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="https://…"
          className={inputClass}
        />
        {imageUrl && (
          <img
            src={imageUrl}
            alt="Event image preview"
            className="mt-2 rounded-xl w-full max-h-48 object-cover"
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as EventStatus)}
            className={inputClass}
          >
            <option value="PENDING">Pending</option>
            <option value="PUBLISHED">Published</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Recurring</label>
          <select
            value={recurringType}
            onChange={(e) => setRecurringType(e.target.value)}
            className={inputClass}
          >
            <option value="">— none —</option>
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
            <option value="BIWEEKLY">Bi-weekly</option>
            <option value="MONTHLY">Monthly</option>
            <option value="ANNUAL">Annual</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="font-body text-sm font-semibold px-6 py-2 rounded-full bg-on-surface text-surface hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          disabled={saving}
          className="font-body text-sm font-semibold px-6 py-2 rounded-full bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
