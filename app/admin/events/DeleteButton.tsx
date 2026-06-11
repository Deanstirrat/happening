"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteButton({ id }: { id: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  // After a soft delete we hold the prior status so "undo" can restore it exactly.
  const [undoStatus, setUndoStatus] = useState<string | null>(null);

  async function handleDelete() {
    setLoading(true);
    const res = await fetch(`/api/admin/events/${id}`, {
      method: "DELETE",
    });
    const data = await res.json().catch(() => ({}));
    setUndoStatus(typeof data.previousStatus === "string" ? data.previousStatus : "PUBLISHED");
    setLoading(false);
    router.refresh();
  }

  async function handleUndo() {
    setLoading(true);
    await fetch(`/api/admin/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: undoStatus }),
    });
    setUndoStatus(null);
    setLoading(false);
    router.refresh();
  }

  if (undoStatus) {
    return (
      <span className="flex items-center gap-2 font-body text-sm">
        <span className="text-on-surface-variant">moved to trash</span>
        <button
          onClick={handleUndo}
          disabled={loading}
          className="font-semibold px-4 py-1.5 rounded-full bg-surface-container-low text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-50"
        >
          Undo
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="font-body text-sm font-semibold px-4 py-1.5 rounded-full bg-[#ef4444]/15 text-[#ef4444] hover:bg-[#ef4444]/25 transition-colors disabled:opacity-50"
    >
      Delete
    </button>
  );
}
