"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteCostButton({ id, secret }: { id: string; secret: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (!window.confirm("Delete this cost entry?")) return;
    setLoading(true);
    await fetch(`/api/admin/costs/${id}`, {
      method: "DELETE",
      headers: { "x-scrape-secret": secret },
    });
    router.refresh();
    setLoading(false);
  }

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="font-body text-xs text-on-surface-variant hover:text-error transition-colors disabled:opacity-40"
    >
      {loading ? "…" : "delete"}
    </button>
  );
}
