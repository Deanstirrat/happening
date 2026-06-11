"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DuplicateActions({
  aId,
  bId,
}: {
  aId: string;
  bId: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<"merge" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "merge" | "dismiss") {
    if (action === "merge" && !window.confirm("Merge these two events into one? The lower-quality one will be archived and redirected.")) {
      return;
    }
    setLoading(action);
    setError(null);
    const res = await fetch("/api/admin/duplicates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, aId, bId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong");
      setLoading(null);
      return;
    }
    router.refresh();
    setLoading(null);
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="font-body text-xs text-[#ef4444]">{error}</span>}
      <button
        onClick={() => act("dismiss")}
        disabled={loading !== null}
        className="font-body text-sm font-semibold px-4 py-1.5 rounded-full bg-surface-container-low text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-50"
      >
        {loading === "dismiss" ? "…" : "not a dup"}
      </button>
      <button
        onClick={() => act("merge")}
        disabled={loading !== null}
        className="font-body text-sm font-semibold px-4 py-1.5 rounded-full bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50"
      >
        {loading === "merge" ? "merging…" : "merge"}
      </button>
    </div>
  );
}
