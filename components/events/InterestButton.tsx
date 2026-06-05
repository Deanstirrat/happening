"use client";

import { useEffect, useState } from "react";
import { Heart } from "lucide-react";

const SESSION_KEY = "happeningSessionId";
const VOTED_KEY = "happeningInterestedEvents";

function getSessionId(): string {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function getVotedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(VOTED_KEY);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set<string>();
  }
}

function persistVoted(eventId: string, voted: boolean) {
  const set = getVotedSet();
  if (voted) set.add(eventId);
  else set.delete(eventId);
  try {
    localStorage.setItem(VOTED_KEY, JSON.stringify([...set]));
  } catch {
    // ignore quota/availability errors
  }
}

type Variant = "detail" | "overlay" | "compact";

interface InterestButtonProps {
  eventId: string;
  initialCount: number;
  variant?: Variant;
}

export default function InterestButton({
  eventId,
  initialCount,
  variant = "detail",
}: InterestButtonProps) {
  const [count, setCount] = useState(initialCount);
  const [interested, setInterested] = useState(false);
  const [pending, setPending] = useState(false);

  // Initial vote state is read from localStorage (anonymous, no server round-trip).
  useEffect(() => {
    setInterested(getVotedSet().has(eventId));
  }, [eventId]);

  async function toggle(e: React.MouseEvent) {
    // Cards wrap this button in a <Link>; don't navigate or bubble.
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;

    const next = !interested;
    // Optimistic update.
    setInterested(next);
    setCount((c) => Math.max(0, c + (next ? 1 : -1)));
    persistVoted(eventId, next);
    setPending(true);

    try {
      const res = await fetch(`/api/events/${eventId}/interest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: getSessionId(), interested: next }),
      });
      if (!res.ok) throw new Error("request failed");
      const data = await res.json();
      // Reconcile with authoritative server count.
      if (typeof data.count === "number") setCount(data.count);
      if (typeof data.interested === "boolean") {
        setInterested(data.interested);
        persistVoted(eventId, data.interested);
      }
    } catch {
      // Revert on failure.
      setInterested(!next);
      setCount((c) => Math.max(0, c + (next ? -1 : 1)));
      persistVoted(eventId, !next);
    } finally {
      setPending(false);
    }
  }

  const label = interested ? "Remove interest" : "I'm interested";
  const countLabel = count > 0 ? count.toLocaleString() : "";

  if (variant === "detail") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={interested}
        aria-label={label}
        className={`btn-secondary w-full py-3 text-sm flex items-center justify-center gap-2 ${
          interested ? "!bg-primary/15" : ""
        }`}
      >
        <Heart
          size={15}
          className={interested ? "text-primary" : ""}
          fill={interested ? "currentColor" : "none"}
        />
        {interested ? "interested" : "i'm interested"}
        {countLabel && <span className="opacity-70">· {countLabel}</span>}
      </button>
    );
  }

  // overlay (on card images) + compact (in card text rows): a small pill.
  const pillBase =
    variant === "overlay"
      ? "bg-black/65 text-white hover:bg-black/80"
      : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={interested}
      aria-label={label}
      className={`flex items-center gap-1 rounded-full px-2 py-1 text-[0.65rem] font-body font-semibold transition-colors ${pillBase}`}
    >
      <Heart
        size={11}
        className={`shrink-0 ${interested ? "text-primary" : ""}`}
        fill={interested ? "currentColor" : "none"}
      />
      {countLabel || "interested"}
    </button>
  );
}
