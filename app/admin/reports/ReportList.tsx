"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ReportStatus } from "@prisma/client";

export interface ReportItem {
  id: string;
  status: ReportStatus;
  createdAtLabel: string;
  // event-report fields
  eventId?: string;
  eventTitle?: string;
  comment?: string | null;
  // bug-report fields
  description?: string;
  pageUrl?: string | null;
  userAgent?: string | null;
  // shared
  email?: string | null;
}

const STATUS_LABELS: Record<ReportStatus, string> = {
  NEW: "new",
  IN_PROGRESS: "in progress",
  RESOLVED: "resolved",
};

const STATUS_COLORS: Record<ReportStatus, string> = {
  NEW: "bg-[#4ade80]/20 text-[#4ade80]",
  IN_PROGRESS: "bg-[#60a5fa]/20 text-[#60a5fa]",
  RESOLVED: "bg-surface-container-high text-on-surface-variant",
};

export default function ReportList({
  kind,
  items,
  secret,
}: {
  kind: "bug" | "event";
  items: ReportItem[];
  secret: string;
}) {
  const router = useRouter();
  const endpoint = kind === "bug" ? "/api/admin/bug-reports" : "/api/admin/event-reports";
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function patch(body: Record<string, unknown>) {
    setLoading(true);
    await fetch(endpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-scrape-secret": secret },
      body: JSON.stringify(body),
    });
    setSelected(new Set());
    router.refresh();
    setLoading(false);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (items.length === 0) {
    return <p className="font-body text-on-surface-variant">Nothing here yet.</p>;
  }

  const unresolved = items.filter((i) => i.status !== "RESOLVED");
  const allUnresolvedSelected =
    unresolved.length > 0 && unresolved.every((i) => selected.has(i.id));

  return (
    <div className="flex flex-col gap-3">
      {/* Bulk action bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() =>
            setSelected(
              allUnresolvedSelected ? new Set() : new Set(unresolved.map((i) => i.id))
            )
          }
          disabled={unresolved.length === 0}
          className="font-body text-xs text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-40"
        >
          {allUnresolvedSelected ? "clear selection" : "select all unresolved"}
        </button>
        {selected.size > 0 && (
          <button
            onClick={() => patch({ ids: [...selected], status: "RESOLVED" })}
            disabled={loading}
            className="font-body text-sm font-semibold px-4 py-1.5 rounded-full bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50"
          >
            mark {selected.size} resolved
          </button>
        )}
      </div>

      {items.map((item) => (
        <div
          key={item.id}
          className={`bg-surface-container rounded-2xl p-5 flex gap-3 ${
            item.status === "RESOLVED" ? "opacity-60" : ""
          }`}
        >
          <input
            type="checkbox"
            checked={selected.has(item.id)}
            onChange={() => toggle(item.id)}
            className="mt-1 shrink-0 accent-primary"
            aria-label="select report"
          />
          <div className="flex flex-col gap-2 min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              {kind === "event" && item.eventId ? (
                <Link
                  href={`/events/${item.eventId}`}
                  target="_blank"
                  className="font-body font-semibold text-sm text-on-surface hover:text-primary transition-colors"
                >
                  {item.eventTitle}
                </Link>
              ) : (
                <p className="font-body text-sm text-on-surface">{item.description}</p>
              )}
              <span className={`chip shrink-0 text-xs ${STATUS_COLORS[item.status]}`}>
                {STATUS_LABELS[item.status]}
              </span>
            </div>

            {kind === "event" &&
              (item.comment ? (
                <p className="font-body text-sm text-on-surface">{item.comment}</p>
              ) : (
                <p className="font-body text-xs text-on-surface-variant italic">
                  no comment provided
                </p>
              ))}

            <div className="flex flex-wrap items-center gap-3 text-xs font-body text-on-surface-variant">
              <span>{item.createdAtLabel}</span>
              {item.email && (
                <a href={`mailto:${item.email}`} className="hover:text-on-surface transition-colors">
                  {item.email}
                </a>
              )}
              {kind === "bug" && item.pageUrl && (
                <a
                  href={item.pageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-on-surface underline truncate max-w-xs"
                >
                  {item.pageUrl}
                </a>
              )}
              {kind === "event" && item.eventId && (
                <Link
                  href={`/admin/events/${item.eventId}/edit?secret=${secret}`}
                  className="hover:text-on-surface transition-colors underline"
                >
                  edit event
                </Link>
              )}
            </div>

            {kind === "bug" && item.userAgent && (
              <p className="font-body text-xs text-on-surface-variant truncate">{item.userAgent}</p>
            )}

            {/* Per-item status controls */}
            <div className="flex gap-2 flex-wrap mt-1">
              {item.status === "NEW" && (
                <button
                  onClick={() => patch({ id: item.id, status: "IN_PROGRESS" })}
                  disabled={loading}
                  className="font-body text-xs font-semibold px-3 py-1 rounded-full bg-[#60a5fa]/20 text-[#60a5fa] hover:bg-[#60a5fa]/30 transition-colors disabled:opacity-50"
                >
                  start
                </button>
              )}
              {item.status !== "RESOLVED" && (
                <button
                  onClick={() => patch({ id: item.id, status: "RESOLVED" })}
                  disabled={loading}
                  className="font-body text-xs font-semibold px-3 py-1 rounded-full bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50"
                >
                  resolve
                </button>
              )}
              {item.status === "RESOLVED" && (
                <button
                  onClick={() => patch({ id: item.id, status: "NEW" })}
                  disabled={loading}
                  className="font-body text-xs font-semibold px-3 py-1 rounded-full bg-surface-container-low text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-50"
                >
                  reopen
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
