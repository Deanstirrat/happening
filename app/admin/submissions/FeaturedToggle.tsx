"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function FeaturedToggle({
  id,
  featured,
  secret,
}: {
  id: string;
  featured: boolean;
  secret: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function toggle() {
    setLoading(true);
    await fetch(`/api/admin/events/${id}/featured`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-scrape-secret": secret,
      },
      body: JSON.stringify({ featured: !featured }),
    });
    router.refresh();
    setLoading(false);
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`font-body text-sm font-semibold px-4 py-1.5 rounded-full transition-colors disabled:opacity-50 ${
        featured
          ? "bg-primary/20 text-primary hover:bg-primary/30"
          : "bg-surface-container-low text-on-surface-variant hover:text-on-surface"
      }`}
    >
      {featured ? "★ featured" : "mark featured"}
    </button>
  );
}
