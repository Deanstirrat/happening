"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export default function EventSearch({ status }: { status?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = searchParams.get("q") ?? "";

  const update = useCallback(
    (value: string) => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (value) params.set("q", value);
      router.replace(`/admin/events?${params.toString()}`);
    },
    [router, status]
  );

  return (
    <input
      type="search"
      defaultValue={q}
      onChange={(e) => update(e.target.value)}
      placeholder="Search by title or venue…"
      className="w-full font-body text-sm text-on-surface bg-surface-container rounded-xl px-4 py-2.5 border border-transparent focus:border-on-surface-variant focus:outline-none transition-colors"
    />
  );
}
