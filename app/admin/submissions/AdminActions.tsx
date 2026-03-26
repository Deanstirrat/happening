"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminActions({ id, secret }: { id: string; secret: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function act(action: "approve" | "reject") {
    setLoading(true);
    await fetch("/api/admin/submissions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-scrape-secret": secret,
      },
      body: JSON.stringify({ id, action }),
    });
    router.refresh();
    setLoading(false);
  }

  return (
    <div className="flex gap-2">
      <button
        onClick={() => act("approve")}
        disabled={loading}
        className="font-body text-sm font-semibold px-4 py-1.5 rounded-full bg-[#4ade80]/20 text-[#4ade80] hover:bg-[#4ade80]/30 transition-colors disabled:opacity-50"
      >
        Approve
      </button>
      <button
        onClick={() => act("reject")}
        disabled={loading}
        className="font-body text-sm font-semibold px-4 py-1.5 rounded-full bg-surface-container-low text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-50"
      >
        Reject
      </button>
    </div>
  );
}
