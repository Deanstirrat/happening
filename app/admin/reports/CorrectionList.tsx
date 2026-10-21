"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ReportStatus } from "@prisma/client";

export interface CorrectionDiff {
  label: string;
  current: string;
  suggested: string;
}

export interface CorrectionItem {
  id: string;
  status: ReportStatus;
  createdAtLabel: string;
  eventId: string;
  eventTitle: string;
  isOrganizer: boolean;
  comment: string | null;
  email: string | null;
  diffs: CorrectionDiff[];
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

export default function CorrectionList({ items }: { items: CorrectionItem[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setLoading(true);
    await fetch("/api/admin/corrections", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    router.refresh();
    setLoading(false);
  }

  if (items.length === 0) {
    return <p className="font-body text-on-surface-variant">No corrections yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {items.map((item) => (
        <div
          key={item.id}
          className={`bg-surface-container rounded-2xl p-5 flex flex-col gap-3 ${
            item.status === "RESOLVED" ? "opacity-60" : ""
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1 min-w-0">
              <Link
                href={`/events/${item.eventId}`}
                target="_blank"
                className="font-headline font-bold text-lg text-on-surface leading-tight hover:text-primary transition-colors"
              >
                {item.eventTitle}
              </Link>
              <div className="flex flex-wrap items-center gap-2">
                {item.isOrganizer && (
                  <span className="chip text-xs bg-primary/20 text-primary">organizer</span>
                )}
                {item.email && (
                  <a
                    href={`mailto:${item.email}`}
                    className="font-body text-xs text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    {item.email}
                  </a>
                )}
              </div>
            </div>
            <span className={`chip shrink-0 text-xs ${STATUS_COLORS[item.status]}`}>
              {STATUS_LABELS[item.status]}
            </span>
          </div>

          {item.comment && (
            <p className="font-body text-sm text-on-surface">{item.comment}</p>
          )}

          {/* Suggested edits diff */}
          <div className="bg-surface-container-high rounded-xl p-3 flex flex-col gap-1.5">
            <span className="font-body text-xs text-on-surface-variant uppercase tracking-wider">
              suggested edits
            </span>
            {item.diffs.map((d) => (
              <div key={d.label} className="font-body text-xs leading-relaxed">
                <span className="text-on-surface-variant font-medium">{d.label}:</span>{" "}
                {d.current ? (
                  <>
                    <span className="text-on-surface-variant line-through">
                      {d.current.length > 80 ? `${d.current.slice(0, 80)}…` : d.current}
                    </span>
                    {" → "}
                  </>
                ) : (
                  <span className="text-on-surface-variant italic">empty → </span>
                )}
                <span className="text-[#4ade80]">
                  {d.suggested.length > 80 ? `${d.suggested.slice(0, 80)}…` : d.suggested}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="font-body text-xs text-on-surface-variant">{item.createdAtLabel}</span>
            <div className="ml-auto flex gap-2 flex-wrap">
              {item.status !== "RESOLVED" && (
                <>
                  <button
                    onClick={() => patch({ id: item.id, action: "apply" })}
                    disabled={loading}
                    className="font-body text-sm font-semibold px-4 py-1.5 rounded-full bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50"
                  >
                    apply edits
                  </button>
                  {item.status === "NEW" && (
                    <button
                      onClick={() => patch({ id: item.id, status: "IN_PROGRESS" })}
                      disabled={loading}
                      className="font-body text-sm font-semibold px-4 py-1.5 rounded-full bg-[#60a5fa]/20 text-[#60a5fa] hover:bg-[#60a5fa]/30 transition-colors disabled:opacity-50"
                    >
                      start
                    </button>
                  )}
                  <button
                    onClick={() => patch({ id: item.id, status: "RESOLVED" })}
                    disabled={loading}
                    className="font-body text-sm font-semibold px-4 py-1.5 rounded-full bg-surface-container-low text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-50"
                  >
                    dismiss
                  </button>
                </>
              )}
              {item.status === "RESOLVED" && (
                <button
                  onClick={() => patch({ id: item.id, status: "NEW" })}
                  disabled={loading}
                  className="font-body text-sm font-semibold px-4 py-1.5 rounded-full bg-surface-container-low text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-50"
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
