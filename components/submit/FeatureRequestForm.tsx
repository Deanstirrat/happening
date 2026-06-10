"use client";

import { useState, useEffect, useRef } from "react";
import { Search, ArrowLeft, ChevronRight } from "lucide-react";
import { formatTimeSF } from "@/lib/sfDate";
import { CATEGORY_LABELS, CATEGORY_COLORS } from "@/lib/types";
import type { EventCategory } from "@/lib/types";
import Link from "next/link";

interface SearchEvent {
  id: string;
  title: string;
  startDate: string;
  endDate: string | null;
  venueName: string | null;
  neighborhood: string | null;
  category: EventCategory | null;
  price: string | null;
  isFree: boolean;
  imageUrl: string | null;
  description: string | null;
  tags: string[];
  sourceUrl: string;
}

type Step = "search" | "suggest" | "success";

const inputClass =
  "w-full bg-surface-container rounded-xl px-4 py-3 font-body text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-1 focus:ring-primary";

export default function FeatureRequestForm() {
  const [step, setStep] = useState<Step>("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchEvent[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<SearchEvent | null>(null);

  // Suggest form state
  const [edits, setEdits] = useState({
    description: "",
    tags: "",
    price: "",
    venueName: "",
    sourceUrl: "",
  });
  const [originalValues, setOriginalValues] = useState({
    description: "",
    tags: "",
    price: "",
    venueName: "",
    sourceUrl: "",
  });
  const [contact, setContact] = useState({ name: "", email: "", message: "" });
  const [submitStatus, setSubmitStatus] = useState<"idle" | "loading" | "error">("idle");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/events/search?q=${encodeURIComponent(query.trim())}`);
        const data = await res.json();
        setResults(data.events ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function selectEvent(event: SearchEvent) {
    setSelectedEvent(event);
    const vals = {
      description: event.description ?? "",
      tags: event.tags?.join(", ") ?? "",
      price: event.price ?? "",
      venueName: event.venueName ?? "",
      sourceUrl: event.sourceUrl ?? "",
    };
    setEdits(vals);
    setOriginalValues(vals);
    setStep("suggest");
  }

  function buildSuggestedEdits(): Record<string, string> | null {
    const changes: Record<string, string> = {};
    for (const key of Object.keys(edits) as (keyof typeof edits)[]) {
      if (edits[key].trim() !== originalValues[key].trim()) {
        changes[key] = edits[key].trim();
      }
    }
    return Object.keys(changes).length > 0 ? changes : null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitStatus("loading");

    try {
      const suggestedEdits = buildSuggestedEdits();
      const res = await fetch("/api/feature-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: contact.name,
          email: contact.email,
          message: contact.message,
          eventId: selectedEvent?.id,
          suggestedEdits,
        }),
      });

      if (!res.ok) {
        throw new Error("Request failed");
      }

      setStep("success");
    } catch {
      setSubmitStatus("error");
    }
  }

  // --- Search step ---
  if (step === "search") {
    return (
      <div className="flex flex-col gap-6">
        {/* Search input */}
        <div className="relative">
          <Search
            size={16}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search for an event by name or venue..."
            className={`${inputClass} pl-10`}
            autoFocus
          />
        </div>

        {/* Results */}
        {searching && (
          <p className="font-body text-sm text-on-surface-variant">searching...</p>
        )}

        {!searching && results.length > 0 && (
          <div className="flex flex-col gap-2">
            {results.map((event) => {
              const time = formatTimeSF(new Date(event.startDate));
              const catLabel = event.category ? CATEGORY_LABELS[event.category] : null;
              const catColor = event.category ? CATEGORY_COLORS[event.category] : "#3a3a3a";
              return (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => selectEvent(event)}
                  className="bg-surface-container rounded-xl p-3 flex items-center gap-3 hover:bg-surface-container-high transition-colors text-left w-full group"
                >
                  <div className="flex-1 min-w-0">
                    <h3 className="font-body font-semibold text-sm text-on-surface leading-tight truncate group-hover:text-primary transition-colors">
                      {event.title}
                    </h3>
                    <p className="text-on-surface-variant text-xs font-body mt-0.5">
                      {time}
                      {event.venueName ? ` · ${event.venueName}` : ""}
                    </p>
                    {catLabel && (
                      <span
                        className="inline-block text-[0.6rem] px-1.5 py-0.5 rounded-full font-body font-medium mt-1.5"
                        style={{ background: catColor, color: "#0e0e0e" }}
                      >
                        {catLabel}
                      </span>
                    )}
                  </div>
                  <ChevronRight size={16} className="text-on-surface-variant shrink-0" />
                </button>
              );
            })}
          </div>
        )}

        {!searching && query.trim().length >= 2 && results.length === 0 && (
          <p className="font-body text-sm text-on-surface-variant">
            no events found for &ldquo;{query}&rdquo;
          </p>
        )}

        {/* CTA for event not found */}
        <div className="border-t border-surface-container-high pt-6 mt-2">
          <p className="font-body text-sm text-on-surface-variant mb-3">
            don&apos;t see your event?
          </p>
          <Link
            href="/submit?fromFeature=true"
            className="btn-secondary inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold"
          >
            submit a new event
            <ChevronRight size={14} />
          </Link>
        </div>
      </div>
    );
  }

  // --- Success step ---
  if (step === "success") {
    return (
      <div className="bg-surface-container rounded-2xl p-8 text-center">
        <p className="font-headline font-bold text-xl text-on-surface lowercase mb-2">
          request received
        </p>
        <p className="font-body text-sm text-on-surface-variant">
          thanks for the suggestion — we&apos;ll review it and get back to you at{" "}
          {contact.email}.
        </p>
      </div>
    );
  }

  // --- Suggest step ---
  const time = selectedEvent ? formatTimeSF(new Date(selectedEvent.startDate)) : "";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* Back + selected event header */}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => {
            setStep("search");
            setSelectedEvent(null);
            setSubmitStatus("idle");
          }}
          className="flex items-center gap-1.5 text-on-surface-variant hover:text-on-surface text-sm font-body transition-colors w-fit"
        >
          <ArrowLeft size={14} />
          back to search
        </button>

        <div className="bg-surface-container rounded-xl p-4">
          <h3 className="font-headline font-bold text-lg text-on-surface leading-tight lowercase">
            {selectedEvent?.title}
          </h3>
          <p className="text-on-surface-variant text-xs font-body mt-1">
            {time}
            {selectedEvent?.venueName ? ` · ${selectedEvent.venueName}` : ""}
            {selectedEvent?.neighborhood ? ` · ${selectedEvent.neighborhood}` : ""}
          </p>
        </div>
      </div>

      {/* Suggested edits */}
      <div className="flex flex-col gap-4">
        <div>
          <h4 className="font-headline font-bold text-sm text-on-surface lowercase mb-1">
            suggest edits
          </h4>
          <p className="font-body text-xs text-on-surface-variant">
            update any fields you think should be changed. only your changes will be sent.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-body text-xs text-on-surface-variant uppercase tracking-wider">
            description
          </label>
          <textarea
            value={edits.description}
            onChange={(e) => setEdits((s) => ({ ...s, description: e.target.value }))}
            rows={3}
            placeholder="event description..."
            className={`${inputClass} resize-none`}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="font-body text-xs text-on-surface-variant uppercase tracking-wider">
              venue name
            </label>
            <input
              type="text"
              value={edits.venueName}
              onChange={(e) => setEdits((s) => ({ ...s, venueName: e.target.value }))}
              placeholder="venue name"
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-body text-xs text-on-surface-variant uppercase tracking-wider">
              price
            </label>
            <input
              type="text"
              value={edits.price}
              onChange={(e) => setEdits((s) => ({ ...s, price: e.target.value }))}
              placeholder="e.g. $15, Free"
              className={inputClass}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-body text-xs text-on-surface-variant uppercase tracking-wider">
            tags
          </label>
          <input
            type="text"
            value={edits.tags}
            onChange={(e) => setEdits((s) => ({ ...s, tags: e.target.value }))}
            placeholder="comma-separated tags"
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-body text-xs text-on-surface-variant uppercase tracking-wider">
            source url
          </label>
          <input
            type="url"
            value={edits.sourceUrl}
            onChange={(e) => setEdits((s) => ({ ...s, sourceUrl: e.target.value }))}
            placeholder="https://..."
            className={inputClass}
          />
        </div>
      </div>

      {/* Why feature */}
      <div className="flex flex-col gap-4 border-t border-surface-container-high pt-6">
        <div className="flex flex-col gap-1.5">
          <label className="font-body text-xs text-on-surface-variant uppercase tracking-wider">
            why should this be featured? *
          </label>
          <textarea
            value={contact.message}
            onChange={(e) => setContact((s) => ({ ...s, message: e.target.value }))}
            placeholder="what makes this event special? who's it for?"
            rows={3}
            required
            className={`${inputClass} resize-none`}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="font-body text-xs text-on-surface-variant uppercase tracking-wider">
              your name *
            </label>
            <input
              type="text"
              value={contact.name}
              onChange={(e) => setContact((s) => ({ ...s, name: e.target.value }))}
              placeholder="Jane Smith"
              required
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-body text-xs text-on-surface-variant uppercase tracking-wider">
              email *
            </label>
            <input
              type="email"
              value={contact.email}
              onChange={(e) => setContact((s) => ({ ...s, email: e.target.value }))}
              placeholder="jane@example.com"
              required
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {submitStatus === "error" && (
        <p className="font-body text-xs text-[#ef4444]">
          something went wrong. please try again.
        </p>
      )}

      <button
        type="submit"
        disabled={submitStatus === "loading"}
        className="btn-primary py-3.5 text-sm font-semibold disabled:opacity-50"
      >
        {submitStatus === "loading" ? "sending..." : "submit request"}
      </button>
    </form>
  );
}
