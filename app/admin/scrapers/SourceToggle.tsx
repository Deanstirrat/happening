"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SourceToggle({
  id,
  enabled,
}: {
  id: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function toggle() {
    setLoading(true);
    await fetch(`/api/admin/sources/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !enabled }),
    });
    router.refresh();
    setLoading(false);
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      title={enabled ? "Disable this scraper" : "Enable this scraper"}
      className={`font-body text-[0.65rem] font-semibold px-2.5 py-1 rounded-full transition-colors disabled:opacity-50 ${
        enabled
          ? "bg-[#0d3323] text-[#4caf7d] hover:bg-[#114029]"
          : "bg-surface-container-low text-on-surface-variant hover:text-on-surface"
      }`}
    >
      {enabled ? "enabled" : "disabled"}
    </button>
  );
}
