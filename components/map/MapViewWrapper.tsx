"use client";

import dynamic from "next/dynamic";
import type { EventSummary } from "@/lib/types";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center bg-surface-container-lowest h-full">
      <p className="font-body text-on-surface-variant text-sm">Loading map…</p>
    </div>
  ),
});

export default function MapViewWrapper({ events }: { events: EventSummary[] }) {
  return <MapView events={events} />;
}
