import Link from "next/link";
import Image from "next/image";
import { Repeat2, Star } from "lucide-react";
import { formatCarouselDateSF, formatCarouselDateOnlySF, formatTimeSF } from "@/lib/sfDate";
import type { EventSummary } from "@/lib/types";
import { CATEGORY_LABELS, CATEGORY_COLORS } from "@/lib/types";
import { CATEGORY_IMAGES } from "@/lib/categoryImages";
import { CategoryImage } from "@/components/events/CategoryImage";


function recurringLabel(event: EventSummary): string | null {
  if (!event.tags?.includes("recurring")) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
  }).formatToParts(new Date(event.startDate));
  const day = parts.find((p) => p.type === "weekday")?.value?.toLowerCase() ?? "";
  return day ? `every ${day}` : null;
}

const NEIGHBORHOOD_DISPLAY: Record<string, string> = {
  "South of Market": "SoMa",
  "Downtown/Civic Center": "Downtown",
};

function formatPrice(price: string): string {
  return price.startsWith("$") ? price : `$${price}`;
}

interface EventCardProps {
  event: EventSummary;
  featured?: boolean;
}

export default function EventCard({ event, featured = false }: EventCardProps) {
  const carouselDate = event.allDay
    ? formatCarouselDateOnlySF(new Date(event.startDate))
    : formatCarouselDateSF(new Date(event.startDate));
  const time = event.allDay ? "All day" : formatTimeSF(new Date(event.startDate));
  const categoryLabel = event.category ? CATEGORY_LABELS[event.category] : null;
  const categoryColor = event.category ? CATEGORY_COLORS[event.category] : "#574142";
  const categoryImage = event.category ? (CATEGORY_IMAGES[event.category] ?? null) : null;
  const neighborhood = event.neighborhood
    ? (NEIGHBORHOOD_DISPLAY[event.neighborhood] ?? event.neighborhood)
    : null;
  const recLabel = recurringLabel(event);
  const rawImageUrl = event.imageUrl?.startsWith("//") ? `https:${event.imageUrl}` : event.imageUrl;
  const imageUrl = rawImageUrl?.startsWith("http")
    ? `/api/image-proxy?url=${encodeURIComponent(rawImageUrl)}`
    : rawImageUrl;

  if (featured) {
    return (
      <Link href={`/events/${event.id}`} className="block group">
        <div className="relative rounded-lg overflow-hidden aspect-[16/9] bg-surface-container">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={event.title}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-105"
              sizes="(max-width: 768px) 100vw, 60vw"
            />
          ) : categoryImage ? (
            <CategoryImage
              src={categoryImage}
              alt={categoryLabel ?? event.title}
              sizes="(max-width: 768px) 100vw, 60vw"
              gradient={`linear-gradient(135deg, ${categoryColor}44, ${categoryColor}11)`}
              imageClassName="object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-surface-container-high to-surface-container-lowest" />
          )}
          {/* Bottom gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

          {/* Recurring badge */}
          {recLabel && (
            <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/70 text-white text-[0.6rem] font-body font-semibold uppercase tracking-wider px-2 py-1 rounded-full">
              <Repeat2 size={10} className="text-primary shrink-0" />
              {recLabel}
            </div>
          )}

          {/* Chips: top-left on mobile only */}
          <div className="absolute top-2 left-2 flex gap-2 sm:hidden">
            {neighborhood && (
              <span className="chip text-[0.6rem] uppercase tracking-wider truncate max-w-[9rem]">
                {neighborhood}
              </span>
            )}
            {categoryLabel && (
              <span
                className="chip text-[0.6rem] uppercase tracking-wider"
                style={{ background: categoryColor, color: "#0e0e0e" }}
              >
                {categoryLabel}
              </span>
            )}
          </div>

          {/* Bottom content */}
          <div className="absolute bottom-0 left-0 right-0 p-5">
            {/* Chips row: bottom on sm+ only */}
            <div className="hidden sm:flex gap-2 mb-2">
              {neighborhood && (
                <span className="chip text-[0.6rem] uppercase tracking-wider truncate max-w-[9rem]">
                  {neighborhood}
                </span>
              )}
              {categoryLabel && (
                <span
                  className="chip text-[0.6rem] uppercase tracking-wider"
                  style={{ background: categoryColor, color: "#0e0e0e" }}
                >
                  {categoryLabel}
                </span>
              )}
            </div>

            {/* Title */}
            <h3 className="font-headline font-bold text-2xl text-white leading-tight mb-3 lowercase">
              {event.title}
            </h3>

            {/* Date/time */}
            <div className="flex items-center gap-4">
              <span className="text-white/70 text-xs font-body uppercase tracking-wide">
                {carouselDate}
              </span>
            </div>
          </div>
        </div>
      </Link>
    );
  }

  // Compact card (side / grid)
  return (
    <Link href={`/events/${event.id}`} className="block group">
      <div className="bg-surface-container rounded-DEFAULT overflow-hidden flex gap-3 p-3 hover:bg-surface-container-high transition-colors">
        {/* Thumbnail */}
        <div className="relative w-16 h-16 shrink-0 rounded-[0.75rem] overflow-hidden bg-surface-container-high">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={event.title}
              fill
              className="object-cover"
              sizes="64px"
            />
          ) : categoryImage ? (
            <CategoryImage
              src={categoryImage}
              alt={categoryLabel ?? event.title}
              sizes="64px"
              gradient={`linear-gradient(135deg, ${categoryColor}33, ${categoryColor}11)`}
            />
          ) : (
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(135deg, ${categoryColor}33, ${categoryColor}11)`,
              }}
            />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h3 className="font-body font-semibold text-sm text-on-surface leading-tight truncate group-hover:text-primary transition-colors">
            {event.title}
          </h3>
          <p className="text-on-surface-variant text-xs font-body mt-0.5">
            {time}
            {event.venueName ? ` · ${event.venueName}` : ""}
          </p>
          <div className="flex items-center gap-1.5 mt-1.5">
            {event.spotifyArtist && (
              <span className="flex items-center gap-1 text-[0.6rem] px-1.5 py-0.5 rounded-full font-body font-medium bg-[#1DB954]/15 text-[#1DB954] max-w-[9rem] truncate">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                </svg>
                {event.spotifyArtist}
              </span>
            )}
            {categoryLabel && (
              <span
                className="text-[0.6rem] px-1.5 py-0.5 rounded-full font-body font-medium"
                style={{ background: `${categoryColor}22`, color: categoryColor }}
              >
                {categoryLabel}
              </span>
            )}
            {event.isFree && (
              <span className="text-[0.6rem] px-1.5 py-0.5 rounded-full font-body font-medium bg-surface-container-high text-on-surface-variant">
                Free
              </span>
            )}
            {event.price && !event.isFree && (
              <span className="text-[0.6rem] text-on-surface-variant font-body">
                {formatPrice(event.price)}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

// Grid variant (used in tuesday, etc.)
export function EventCardGrid({ event }: { event: EventSummary }) {
  const time = event.allDay ? "All day" : formatTimeSF(new Date(event.startDate));
  const categoryLabel = event.category ? CATEGORY_LABELS[event.category] : null;
  const categoryColor = event.category ? CATEGORY_COLORS[event.category] : "#574142";
  const categoryImage = event.category ? (CATEGORY_IMAGES[event.category] ?? null) : null;
  const neighborhood = event.neighborhood
    ? (NEIGHBORHOOD_DISPLAY[event.neighborhood] ?? event.neighborhood)
    : null;
  const recLabel = recurringLabel(event);
  const rawImageUrl = event.imageUrl?.startsWith("//") ? `https:${event.imageUrl}` : event.imageUrl;
  const imageUrl = rawImageUrl?.startsWith("http")
    ? `/api/image-proxy?url=${encodeURIComponent(rawImageUrl)}`
    : rawImageUrl;

  return (
    <Link href={`/events/${event.id}`} className="block group">
      <div className={`bg-surface-container rounded-DEFAULT overflow-hidden hover:bg-surface-container-high transition-colors${event.featured ? " ring-1 ring-primary/40" : ""}`}>
        {/* Image */}
        <div className="relative aspect-[4/3] bg-surface-container-high">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={event.title}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-105"
              sizes="(max-width: 768px) 50vw, 25vw"
            />
          ) : categoryImage ? (
            <CategoryImage
              src={categoryImage}
              alt={categoryLabel ?? event.title}
              sizes="(max-width: 768px) 50vw, 25vw"
              gradient={`linear-gradient(135deg, ${categoryColor}44, ${categoryColor}11)`}
              imageClassName="object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(135deg, ${categoryColor}44, ${categoryColor}11)`,
              }}
            />
          )}
          {event.featured && (
            <div className="absolute top-2 left-2 flex items-center gap-1 bg-primary text-on-primary text-[0.6rem] font-body font-semibold uppercase tracking-wider px-2 py-1 rounded-full">
              <Star size={8} className="shrink-0" fill="currentColor" />
              featured
            </div>
          )}
          {recLabel && (
            <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/70 text-white text-[0.6rem] font-body font-semibold uppercase tracking-wider px-2 py-1 rounded-full">
              <Repeat2 size={10} className="text-primary shrink-0" />
              {recLabel}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="p-3 h-[5.5rem] overflow-hidden flex flex-col">
          <h3 className="font-body font-semibold text-sm text-on-surface leading-tight line-clamp-2 mb-0.5 group-hover:text-primary transition-colors">
            {event.title}
          </h3>
          <p className="text-on-surface-variant text-xs font-body truncate">
            {time}
            {event.venueName ? ` · ${event.venueName}` : ""}
          </p>
          <div className="flex items-center justify-between mt-auto">
            <span
              className="text-[0.6rem] font-body font-medium"
              style={{ color: categoryColor }}
            >
              {categoryLabel}
            </span>
            <span className="text-[0.6rem] font-body font-medium text-on-surface-variant">
              {event.isFree ? "Free" : event.price ? formatPrice(event.price) : ""}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

