"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TrashActions({ id }: { id: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function restore() {
    setLoading(true);
    await fetch(`/api/admin/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "PUBLISHED" }),
    });
    router.refresh();
    setLoading(false);
  }

  async function purge() {
    if (!window.confirm("Permanently delete this event? This cannot be undone.")) return;
    setLoading(true);
    await fetch(`/api/admin/events/${id}?hard=1`, {
      method: "DELETE",
    });
    router.refresh();
    setLoading(false);
  }

  return (
    <>
      <button
        onClick={restore}
        disabled={loading}
        className="font-body text-sm font-semibold px-4 py-1.5 rounded-full bg-[#4ade80]/20 text-[#4ade80] hover:bg-[#4ade80]/30 transition-colors disabled:opacity-50"
      >
        Restore
      </button>
      <button
        onClick={purge}
        disabled={loading}
        className="font-body text-sm font-semibold px-4 py-1.5 rounded-full bg-[#ef4444]/15 text-[#ef4444] hover:bg-[#ef4444]/25 transition-colors disabled:opacity-50"
      >
        Delete forever
      </button>
    </>
  );
}
