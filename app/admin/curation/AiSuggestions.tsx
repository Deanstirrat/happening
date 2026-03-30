"use client";

import { useState } from "react";
import { format } from "date-fns";
import Link from "next/link";
import FeaturedToggle from "../submissions/FeaturedToggle";
import { CATEGORY_LABELS } from "@/lib/types";
import type { EventCategory } from "@prisma/client";

interface Pick {
  id: string;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  venueName: string | null;
  neighborhood: string | null;
  category: EventCategory | null;
  tags: string[];
  isFree: boolean;
  price: string | null;
  imageUrl: string | null;
  featured: boolean;
  reason: string;
  source: { slug: string; name: string };
}

export default function AiSuggestions({ secret }: { secret: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(
    "idle"
  );
  const [picks, setPicks] = useState<Pick[]>([]);
  const [total, setTotal] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  async function generate() {
    setState("loading");
    setPicks([]);
    try {
      const res = await fetch("/api/admin/curation/suggest", {
        method: "POST",
        headers: { "x-scrape-secret": secret },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setPicks(data.picks);
      setTotal(data.total);
      setState("done");
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  if (state === "idle") {
    return (
      <div className="flex flex-col items-center gap-4 py-16 bg-surface-container rounded-2xl">
        <p className="font-body text-sm text-on-surface-variant text-center max-w-sm">
          AI scans next week&apos;s non-recurring events and surfaces the
          wildest, most distinctly SF ones — weird street happenings,
          underground scenes, big deals. Skip the tame stuff.
        </p>
        <button
          onClick={generate}
          className="btn-primary px-6 py-2.5 text-sm font-semibold"
        >
          generate suggestions
        </button>
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div className="flex flex-col items-center gap-3 py-16 bg-surface-container rounded-2xl">
        <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <p className="font-body text-sm text-on-surface-variant">
          scanning this week&apos;s events…
        </p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex flex-col items-center gap-3 py-8 bg-surface-container rounded-2xl">
        <p className="font-body text-sm text-error">{errorMsg}</p>
        <button onClick={generate} className="btn-primary px-4 py-2 text-xs">
          retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between mb-1">
        <p className="font-body text-xs text-on-surface-variant">
          {picks.length} picks from {total} non-recurring events this week
        </p>
        <div className="flex items-center gap-4">
          <button
            onClick={generate}
            className="font-body text-xs text-on-surface-variant hover:text-on-surface transition-colors"
          >
            regenerate
          </button>
          <button
            onClick={() => setState("idle")}
            className="font-body text-xs text-on-surface-variant hover:text-on-surface transition-colors"
          >
            clear
          </button>
        </div>
      </div>

      {picks.map((event) => {
        const catLabel = event.category ? CATEGORY_LABELS[event.category] : null;
        return (
          <div
            key={event.id}
            className="bg-surface-container rounded-2xl px-5 py-4 flex gap-4"
          >
            {event.imageUrl && (
              <div
                className="w-14 h-14 rounded-lg shrink-0 bg-cover bg-center bg-surface-container-high"
                style={{ backgroundImage: `url(${event.imageUrl})` }}
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/events/${event.id}?secret=${secret}`}
                    target="_blank"
                    className="font-body font-semibold text-sm text-on-surface hover:text-primary transition-colors line-clamp-1"
                  >
                    {event.title}
                  </Link>
                  <p className="font-body text-xs text-on-surface-variant mt-0.5">
                    {format(new Date(event.startDate), "EEE, MMM d · h:mm a")}
                    {event.venueName && ` · ${event.venueName}`}
                    {event.neighborhood && ` · ${event.neighborhood}`}
                  </p>
                </div>
                <FeaturedToggle
                  id={event.id}
                  featured={event.featured}
                  secret={secret}
                />
              </div>

              <p className="font-body text-xs text-primary mt-1.5 italic leading-relaxed">
                &ldquo;{event.reason}&rdquo;
              </p>

              <div className="flex flex-wrap gap-1 mt-2">
                {catLabel && (
                  <span className="chip text-[0.6rem]">{catLabel}</span>
                )}
                {(event.isFree || event.price) && (
                  <span className="chip text-[0.6rem]">
                    {event.isFree ? "Free" : event.price}
                  </span>
                )}
                {event.tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="chip text-[0.6rem]">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
