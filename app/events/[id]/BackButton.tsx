"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

export default function BackButton() {
  const router = useRouter();

  function handleBack() {
    // Return to wherever the visitor came from (the map, explore, saved…) so
    // back from an event detail doesn't dump them on the explore list. Fall
    // back to /events when there's no in-app history — e.g. a shared link
    // opened directly in a fresh tab.
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/events");
    }
  }

  return (
    <button
      onClick={handleBack}
      className="flex items-center gap-2 text-on-surface-variant hover:text-on-surface text-xs font-body uppercase tracking-widest transition-colors"
    >
      <ArrowLeft size={13} />
      back
    </button>
  );
}
