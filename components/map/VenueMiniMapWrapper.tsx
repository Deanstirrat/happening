"use client";

import dynamic from "next/dynamic";

const VenueMiniMap = dynamic(() => import("./VenueMiniMap"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 bg-surface-container-lowest" />
  ),
});

export default function VenueMiniMapWrapper({
  latitude,
  longitude,
}: {
  latitude: number;
  longitude: number;
}) {
  return <VenueMiniMap latitude={latitude} longitude={longitude} />;
}
