"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FeaturedRequestStatus } from "@prisma/client";

export default function FeatureRequestActions({
  id,
  status,
  secret,
  hasLinkedEvent,
}: {
  id: string;
  status: FeaturedRequestStatus;
  secret: string;
  hasLinkedEvent: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function updateStatus(next: FeaturedRequestStatus) {
    setLoading(true);
    await fetch("/api/admin/feature-requests", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-scrape-secret": secret,
      },
      body: JSON.stringify({ id, status: next }),
    });
    router.refresh();
    setLoading(false);
  }

  async function applyAndFeature() {
    setLoading(true);
    await fetch("/api/admin/feature-requests", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-scrape-secret": secret,
      },
      body: JSON.stringify({ id, action: "apply-and-feature" }),
    });
    router.refresh();
    setLoading(false);
  }

  if (status === "CLOSED") {
    return (
      <span className="font-body text-xs text-on-surface-variant px-3 py-1.5 rounded-full bg-surface-container-high">
        closed
      </span>
    );
  }

  return (
    <div className="flex gap-2 flex-wrap">
      {hasLinkedEvent && (
        <button
          onClick={applyAndFeature}
          disabled={loading}
          className="font-body text-sm font-semibold px-4 py-1.5 rounded-full bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50"
        >
          apply edits &amp; feature
        </button>
      )}
      {status === "NEW" && (
        <button
          onClick={() => updateStatus("CONTACTED")}
          disabled={loading}
          className="font-body text-sm font-semibold px-4 py-1.5 rounded-full bg-[#60a5fa]/20 text-[#60a5fa] hover:bg-[#60a5fa]/30 transition-colors disabled:opacity-50"
        >
          mark contacted
        </button>
      )}
      {status === "CONTACTED" && (
        <button
          onClick={() => updateStatus("CLOSED")}
          disabled={loading}
          className="font-body text-sm font-semibold px-4 py-1.5 rounded-full bg-surface-container-low text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-50"
        >
          close
        </button>
      )}
    </div>
  );
}
