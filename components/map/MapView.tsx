"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type { EventSummary } from "@/lib/types";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "@/lib/types";
import { formatDateTimeSF } from "@/lib/sfDate";
import { Heart, Star, Flame } from "lucide-react";
import { categoryIconComponent, categoryIconSvg, glyphSvg } from "./categoryIcons";
import Link from "next/link";
import Image from "next/image";

const MIN_MARKER = 30;
const MAX_MARKER = 58;
const FALLBACK_COLOR = "#9ca3af";

const interestOf = (e: EventSummary) => e.interestCount ?? 0;

/**
 * Marker diameter scales with interest so popular events read as more prominent.
 * A square-root curve keeps the area (roughly) proportional to interest, which
 * stops a single runaway event from dwarfing everything else.
 */
function markerSize(interest: number, maxInterest: number): number {
  if (maxInterest <= 0) return MIN_MARKER;
  const t = Math.sqrt(Math.min(interest, maxInterest) / maxInterest);
  return Math.round(MIN_MARKER + t * (MAX_MARKER - MIN_MARKER));
}

/** "Trending" = meaningfully popular both in absolute terms and relative to the field. */
function isTrending(interest: number, maxInterest: number): boolean {
  if (maxInterest <= 0 || interest < 4) return false;
  return interest / maxInterest >= 0.3;
}

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

  const maxInterest = events.reduce((m, e) => Math.max(m, interestOf(e)), 0);
  const placed = events.filter((e) => e.latitude != null && e.longitude != null);
  const hasFeatured = placed.some((e) => e.featured);
  const hasTrending = placed.some((e) => isTrending(interestOf(e), maxInterest));

  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return;

    let cancelled = false;

    // Dynamically import Leaflet to avoid SSR issues
    import("leaflet").then((L) => {
      // The import is async and React 19 StrictMode mounts effects twice, so bail
      // if this run was torn down (or another run already built the map) before the
      // import resolved — otherwise Leaflet throws "Map container is already initialized".
      if (cancelled || !mapRef.current || leafletMapRef.current) return;

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

      // Tap anywhere on the map (not a marker — those clicks don't propagate)
      // to dismiss the selected-event popup.
      map.on("click", () => setSelectedEvent(null));

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
            "#ff000022",
            "#e9e5d822",
            "#ff5a5222",
            "#b3aea022",
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

      // Badges are rendered once and reused across every marker.
      const starSvg = glyphSvg(Star, { size: 10, color: "#1a1300", fill: "#1a1300", strokeWidth: 1.5 });
      const flameSvg = glyphSvg(Flame, { size: 11, color: "#ffffff", strokeWidth: 2 });

      // Add event markers
      const eventsWithCoords = events.filter(
        (e) => e.latitude != null && e.longitude != null
      );
      const max = eventsWithCoords.reduce((m, e) => Math.max(m, interestOf(e)), 0);

      eventsWithCoords.forEach((event) => {
        const color = event.category
          ? CATEGORY_COLORS[event.category] ?? "#78716c"
          : FALLBACK_COLOR;
        const interest = interestOf(event);
        const size = markerSize(interest, max);
        const trending = isTrending(interest, max);
        const featured = event.featured;
        const iconSvg = categoryIconSvg(event.category, {
          size: Math.round(size * 0.5),
          color: "#ffffff",
          strokeWidth: 2.25,
        });

        const chipShadow = featured
          ? "0 0 0 2px #121212,0 0 0 4px #f5c451,0 6px 16px rgba(0,0,0,.5)"
          : "0 0 0 2px #121212,0 4px 12px rgba(0,0,0,.45)";

        const html = `
          <div class="happening-marker" style="width:${size}px;height:${size}px;">
            ${trending ? `<span class="happening-pulse" style="color:${color};"></span>` : ""}
            <span class="happening-chip" style="width:${size}px;height:${size}px;background:${color};box-shadow:${chipShadow};">${iconSvg}</span>
            ${featured ? `<span class="happening-badge happening-badge--feat">${starSvg}</span>` : ""}
            ${trending ? `<span class="happening-badge happening-badge--hot">${flameSvg}</span>` : ""}
          </div>`;

        const icon = L.divIcon({
          html,
          className: "",
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });

        // Bigger / featured / trending markers sit on top so they're never hidden.
        const marker = L.marker([event.latitude!, event.longitude!], {
          icon,
          riseOnHover: true,
          zIndexOffset:
            Math.min(interest, 800) + (featured ? 1000 : 0) + (trending ? 400 : 0),
        });
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
      cancelled = true;
      leafletMapRef.current?.remove();
      leafletMapRef.current = null;
    };
  }, [events]);

  const eventsWithCoords = events.filter((e) => e.latitude != null);
  const neighborhoodCount = new Set(events.map((e) => e.neighborhood).filter(Boolean)).size;
  const selectedInterest = selectedEvent ? interestOf(selectedEvent) : 0;

  return (
    <div className="relative w-full h-full">
      {/* Map */}
      <div ref={mapRef} className="absolute inset-0" />

      {/* Category + indicator legend */}
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
              {activeCategories.map((cat) => {
                const Icon = categoryIconComponent(cat);
                const color = CATEGORY_COLORS[cat] ?? "#78716c";
                return (
                  <div key={cat} className="flex items-center gap-2">
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: `${color}22` }}
                    >
                      <Icon size={12} color={color} strokeWidth={2.4} />
                    </span>
                    <span className="text-xs font-body text-on-surface whitespace-nowrap">
                      {CATEGORY_LABELS[cat] ?? cat}
                    </span>
                  </div>
                );
              })}

              {(hasFeatured || hasTrending || maxInterest > 0) && (
                <div className="mt-1 pt-2 border-t border-outline-variant/50 flex flex-col gap-1.5">
                  {hasFeatured && (
                    <div className="flex items-center gap-2">
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: "#f5c451" }}
                      >
                        <Star size={11} color="#1a1300" fill="#1a1300" strokeWidth={1.5} />
                      </span>
                      <span className="text-xs font-body text-on-surface whitespace-nowrap">
                        Featured
                      </span>
                    </div>
                  )}
                  {hasTrending && (
                    <div className="flex items-center gap-2">
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: "linear-gradient(135deg,#ff7a18,#ff0000)" }}
                      >
                        <Flame size={11} color="#ffffff" strokeWidth={2} />
                      </span>
                      <span className="text-xs font-body text-on-surface whitespace-nowrap">
                        Trending now
                      </span>
                    </div>
                  )}
                  {maxInterest > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="w-5 flex items-center justify-center gap-0.5 shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-on-surface-variant" />
                        <span className="w-3 h-3 rounded-full bg-on-surface" />
                      </span>
                      <span className="text-xs font-body text-on-surface-variant whitespace-nowrap">
                        Bigger = more interest
                      </span>
                    </div>
                  )}
                </div>
              )}
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
            <p className="text-on-surface-variant text-xs font-body mb-2">
              {formatDateTimeSF(new Date(selectedEvent.startDate))}
              {selectedEvent.venueName ? ` · ${selectedEvent.venueName}` : ""}
            </p>
            {(selectedEvent.featured || selectedInterest > 0) && (
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                {selectedEvent.featured && (
                  <span
                    className="inline-flex items-center gap-1 text-[0.65rem] font-body font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: "#f5c451", color: "#1a1300" }}
                  >
                    <Star size={10} fill="#1a1300" strokeWidth={1.5} /> Featured
                  </span>
                )}
                {selectedInterest > 0 && (
                  <span className="inline-flex items-center gap-1 text-[0.65rem] font-body text-on-surface-variant">
                    <Heart size={11} className="text-primary" fill="currentColor" />
                    {selectedInterest} interested
                  </span>
                )}
              </div>
            )}
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
