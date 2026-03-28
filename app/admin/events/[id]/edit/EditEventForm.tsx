"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SF_NEIGHBORHOODS, CATEGORY_LABELS } from "@/lib/types";
import { EventCategory, EventStatus } from "@prisma/client";
import { format } from "date-fns";

interface EventData {
  id: string;
  title: string;
  description: string | null;
  startDate: Date;
  endDate: Date | null;
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
}

function toDatetimeLocal(date: Date | null): string {
  if (!date) return "";
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

export default function EditEventForm({ event, secret }: { event: EventData; secret: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description ?? "");
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const res = await fetch(`/api/admin/events/${event.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-scrape-secret": secret,
      },
      body: JSON.stringify({
        title,
        description: description || null,
        startDate: new Date(startDate).toISOString(),
        endDate: endDate ? new Date(endDate).toISOString() : null,
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
      }),
    });

    if (!res.ok) {
      setError("Failed to save. Please try again.");
      setSaving(false);
      return;
    }

    router.push(`/admin/events?secret=${secret}`);
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

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Start Date</label>
          <input
            type="datetime-local"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>End Date</label>
          <input
            type="datetime-local"
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
