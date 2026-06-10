"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

// A small, non-interactive dark map centered on a single venue.
// Matches the /map page styling: CartoDB dark tiles + brand-red marker.
export default function VenueMiniMap({
  latitude,
  longitude,
}: {
  latitude: number;
  longitude: number;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<any>(null);

  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return;

    import("leaflet").then((L) => {
      const map = L.map(mapRef.current!, {
        center: [latitude, longitude],
        zoom: 15,
        zoomControl: false,
        attributionControl: false,
        // Static, decorative map — disable all interaction
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
      });

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        subdomains: "abcd",
        maxZoom: 20,
      }).addTo(map);

      const icon = L.divIcon({
        html: `<div style="
          width:22px;height:22px;
          border-radius:50% 50% 50% 0;
          transform:rotate(-45deg);
          background:#ff0000;
          border:2px solid #121212;
          box-shadow:0 4px 12px rgba(0,0,0,0.5);
        "></div>`,
        className: "",
        iconSize: [22, 22],
        iconAnchor: [11, 22],
      });

      L.marker([latitude, longitude], { icon }).addTo(map);

      leafletMapRef.current = map;
      // Double rAF ensures layout is stable before tiles are positioned
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          leafletMapRef.current?.invalidateSize();
        });
      });
    });

    return () => {
      leafletMapRef.current?.remove();
      leafletMapRef.current = null;
    };
  }, [latitude, longitude]);

  return <div ref={mapRef} className="absolute inset-0" />;
}
