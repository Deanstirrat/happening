"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type { EventSummary } from "@/lib/types";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "@/lib/types";
import { formatDateTimeSF } from "@/lib/sfDate";
import Link from "next/link";
import Image from "next/image";

// Leaflet must be loaded client-side only
export default function MapView({ events }: { events: EventSummary[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<any>(null);
  const [selectedEvent, setSelectedEvent] = useState<EventSummary | null>(null);
  const [stats, setStats] = useState({ neighborhoods: 0 });
  const [legendOpen, setLegendOpen] = useState(true);

  const activeCategories = Array.from(
    new Set(events.map((e) => e.category).filter(Boolean))
  ) as string[];

  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return;

    // Dynamically import Leaflet to avoid SSR issues
    import("leaflet").then((L) => {
      // Fix default icon paths
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "/leaflet/marker-icon-2x.png",
        iconUrl: "/leaflet/marker-icon.png",
        shadowUrl: "/leaflet/marker-shadow.png",
      });

      const map = L.map(mapRef.current!, {
        center: [37.7749, -122.4194],
        zoom: 12,
        zoomControl: false,
      });

      L.control.zoom({ position: "topright" }).addTo(map);

      // CartoDB Dark Matter — native dark tiles, no CSS filter needed
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 20,
      }).addTo(map);

      // Load SF neighborhoods GeoJSON
      fetch("/sf-neighborhoods.geojson")
        .then((r) => r.json())
        .then((geojson) => {
          const neighborhoodColors = [
            "#3891fe33",
            "#ff727c33",
            "#adc7ff33",
            "#a8c8ff33",
          ];
          let colorIdx = 0;
          const neighborhoodSet = new Set<string>();

          L.geoJSON(geojson, {
            style: () => ({
              fillColor: neighborhoodColors[colorIdx++ % neighborhoodColors.length],
              fillOpacity: 0.3,
              color: "#ffffff",
              weight: 0.5,
              opacity: 0.2,
            }),
            onEachFeature: (feature, layer) => {
              const name = feature.properties?.nhood ?? feature.properties?.name;
              if (name) neighborhoodSet.add(name);
              if (name) {
                layer.bindTooltip(name, {
                  permanent: false,
                  className: "leaflet-tooltip-dark",
                  direction: "center",
                });
              }
            },
          }).addTo(map);

          setStats({ neighborhoods: neighborhoodSet.size });
        })
        .catch(() => {}); // GeoJSON optional — map still works without it

      // Add event markers
      const eventsWithCoords = events.filter(
        (e) => e.latitude != null && e.longitude != null
      );

      eventsWithCoords.forEach((event) => {
        const color = event.category
          ? CATEGORY_COLORS[event.category]
          : "#ffb3b5";

        // Custom marker HTML
        const icon = L.divIcon({
          html: `<div style="
            width:28px;height:28px;
            border-radius:50%;
            background:${color};
            border:2px solid #131313;
            box-shadow:0 4px 12px rgba(0,0,0,0.4);
            display:flex;align-items:center;justify-content:center;
            font-size:10px;
            cursor:pointer;
          "></div>`,
          className: "",
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });

        const marker = L.marker([event.latitude!, event.longitude!], { icon });
        marker.on("click", () => setSelectedEvent(event));
        marker.addTo(map);
      });

      leafletMapRef.current = map;
      // Double rAF ensures browser has painted and layout is stable before recalculating tile positions
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
  }, [events]);

  const eventsWithCoords = events.filter((e) => e.latitude != null);
  const neighborhoodCount = new Set(events.map((e) => e.neighborhood).filter(Boolean)).size;

  return (
    <div className="relative w-full h-full">
      {/* Map */}
      <div ref={mapRef} className="absolute inset-0" />

      {/* Category legend */}
      {activeCategories.length > 0 && (
        <div className="absolute top-4 left-4 z-[1000] glass rounded-lg overflow-hidden">
          <button
            onClick={() => setLegendOpen((o) => !o)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-body font-semibold text-on-surface-variant uppercase tracking-wider hover:text-on-surface transition-colors"
          >
            <span>Legend</span>
            <span className="ml-4 text-[10px]">{legendOpen ? "▲" : "▼"}</span>
          </button>
          {legendOpen && (
            <div className="px-3 pb-3 flex flex-col gap-1.5 max-h-[40vh] overflow-y-auto">
              {activeCategories.map((cat) => (
                <div key={cat} className="flex items-center gap-2">
                  <div
                    style={{ background: CATEGORY_COLORS[cat] ?? "#78716c" }}
                    className="w-3 h-3 rounded-full shrink-0"
                  />
                  <span className="text-xs font-body text-on-surface whitespace-nowrap">
                    {CATEGORY_LABELS[cat] ?? cat}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Selected event popup */}
      {selectedEvent && (
        <div className="absolute top-4 right-4 z-[1000] w-72 bg-surface-container rounded-lg overflow-hidden shadow-2xl">
          {selectedEvent.imageUrl && (
            <div className="relative aspect-video">
              <Image
                src={selectedEvent.imageUrl}
                alt={selectedEvent.title}
                fill
                className="object-cover"
                sizes="288px"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            </div>
          )}
          <div className="p-4">
            <h3 className="font-body font-semibold text-sm text-on-surface line-clamp-2 mb-1">
              {selectedEvent.title}
            </h3>
            <p className="text-on-surface-variant text-xs font-body mb-3">
              {formatDateTimeSF(new Date(selectedEvent.startDate))}
              {selectedEvent.venueName ? ` · ${selectedEvent.venueName}` : ""}
            </p>
            <div className="flex items-center justify-between">
              <span className="font-body font-semibold text-sm text-on-surface">
                {selectedEvent.isFree ? "Free" : selectedEvent.price ?? ""}
              </span>
              <Link
                href={`/events/${selectedEvent.id}`}
                className="btn-primary text-xs px-4 py-2"
              >
                View
              </Link>
            </div>
          </div>
          <button
            onClick={() => setSelectedEvent(null)}
            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/40 text-white text-xs flex items-center justify-center hover:bg-black/60 transition-colors"
          >
            ×
          </button>
        </div>
      )}

      {/* Bottom stats bar */}
      <div className="absolute bottom-0 left-0 right-0 z-[1000] glass px-6 py-3 flex items-center gap-8 text-xs font-body">
        <div>
          <span className="text-on-surface-variant uppercase tracking-wider text-[0.6rem]">
            Current View
          </span>
          <p className="text-on-surface font-medium">San Francisco, CA</p>
        </div>
        <div>
          <span className="text-on-surface-variant uppercase tracking-wider text-[0.6rem]">
            Events
          </span>
          <p className="text-on-surface font-medium">{eventsWithCoords.length}</p>
        </div>
        <div>
          <span className="text-on-surface-variant uppercase tracking-wider text-[0.6rem]">
            Neighborhoods
          </span>
          <p className="text-on-surface font-medium">
            {neighborhoodCount || stats.neighborhoods}
          </p>
        </div>
      </div>
    </div>
  );
}
