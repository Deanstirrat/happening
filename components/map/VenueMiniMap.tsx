"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

// An interactive dark map centered on a single venue.
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
        zoomControl: true,
        attributionControl: false,
        // Interactive — pan and zoom enabled. Scroll-wheel zoom only after
        // the map gains focus, so page scrolling isn't hijacked on hover.
        scrollWheelZoom: false,
      });
      map.on("focus", () => map.scrollWheelZoom.enable());
      map.on("blur", () => map.scrollWheelZoom.disable());

      // Esri "World Dark Gray Canvas" — keyless dark basemap (CARTO's keyless
      // tiles now 403 with an "API KEY REQUIRED" watermark, #212). Base +
      // labels; native tiles stop at z16, so upscale beyond that.
      L.tileLayer(
        "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
        { maxNativeZoom: 16, maxZoom: 20 }
      ).addTo(map);
      L.tileLayer(
        "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
        { maxNativeZoom: 16, maxZoom: 20 }
      ).addTo(map);

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
