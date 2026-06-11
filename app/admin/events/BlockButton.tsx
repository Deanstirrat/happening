"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function BlockButton({ id }: { id: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleBlock() {
    if (!window.confirm("Delete this event AND add it to the blocklist? It will never be scraped again.")) return;
    setLoading(true);
    await fetch(`/api/admin/events/${id}/block`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    router.refresh();
    setLoading(false);
  }

  return (
    <button
      onClick={handleBlock}
      disabled={loading}
      className="font-body text-sm font-semibold px-4 py-1.5 rounded-full bg-[#f59e0b]/15 text-[#f59e0b] hover:bg-[#f59e0b]/25 transition-colors disabled:opacity-50"
    >
      Block
    </button>
  );
}
