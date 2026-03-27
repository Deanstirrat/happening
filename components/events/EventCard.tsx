import Link from "next/link";
import Image from "next/image";
import { MapPin, Clock } from "lucide-react";
import { formatTimeSF } from "@/lib/sfDate";
import type { EventSummary } from "@/lib/types";
import { CATEGORY_LABELS, CATEGORY_COLORS } from "@/lib/types";
interface EventCardProps {
  event: EventSummary;
  featured?: boolean;
}

export default function EventCard({ event, featured = false }: EventCardProps) {
  const time = formatTimeSF(new Date(event.startDate));
  const categoryLabel = event.category ? CATEGORY_LABELS[event.category] : null;
  const categoryColor = event.category ? CATEGORY_COLORS[event.category] : "#574142";

  if (featured) {
    return (
      <Link href={`/events/${event.id}`} className="block group">
        <div className="relative rounded-lg overflow-hidden aspect-[16/9] bg-surface-container">
          {event.imageUrl ? (
            <Image
              src={event.imageUrl}
              alt={event.title}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-105"
              sizes="(max-width: 768px) 100vw, 60vw"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-surface-container-high to-surface-container-lowest" />
          )}
          {/* Bottom gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

          {/* Chips */}
          <div className="absolute top-4 left-4 flex gap-2">
            {event.featured && (
              <span className="chip text-[0.6rem] uppercase tracking-wider bg-[#ffb3b5]/30 text-[#ffb3b5]">
                ★ featured
              </span>
            )}
            {event.neighborhood && (
              <span className="chip text-[0.6rem] uppercase tracking-wider">
                {event.neighborhood}
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
          <div className="absolute bottom-0 left-0 right-0 p-5 flex items-end justify-between gap-4">
            <div>
              <h3 className="font-headline font-bold text-2xl text-white leading-tight mb-1 lowercase">
                {event.title}
              </h3>
              <div className="flex items-center gap-3 text-white/70 text-xs font-body">
                <span className="flex items-center gap-1">
                  <Clock size={11} />
                  {time}
                </span>
                {event.venueName && (
                  <span className="flex items-center gap-1">
                    <MapPin size={11} />
                    {event.venueName}
                  </span>
                )}
              </div>
            </div>
            {(event.price || event.isFree) && (
              <div className="shrink-0">
                <span className="btn-primary text-xs px-4 py-2">
                  {event.isFree ? "Free" : event.price}
                </span>
              </div>
            )}
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
          {event.imageUrl ? (
            <Image
              src={event.imageUrl}
              alt={event.title}
              fill
              className="object-cover"
              sizes="64px"
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
            {event.featured && (
              <span className="text-[0.6rem] px-1.5 py-0.5 rounded-full font-body font-medium bg-[#ffb3b5]/20 text-[#ffb3b5]">
                ★ featured
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
                {event.price}
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
  const time = formatTimeSF(new Date(event.startDate));
  const categoryLabel = event.category ? CATEGORY_LABELS[event.category] : null;
  const categoryColor = event.category ? CATEGORY_COLORS[event.category] : "#574142";

  return (
    <Link href={`/events/${event.id}`} className="block group">
      <div className="bg-surface-container rounded-DEFAULT overflow-hidden hover:bg-surface-container-high transition-colors">
        {/* Image */}
        <div className="relative aspect-[4/3] bg-surface-container-high">
          {event.imageUrl ? (
            <Image
              src={event.imageUrl}
              alt={event.title}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-105"
              sizes="(max-width: 768px) 50vw, 25vw"
            />
          ) : (
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(135deg, ${categoryColor}44, ${categoryColor}11)`,
              }}
            />
          )}
          {event.neighborhood && (
            <div className="absolute top-2 left-2">
              <span className="chip text-[0.6rem] uppercase tracking-wider">
                {event.neighborhood}
              </span>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="p-3">
          <h3 className="font-body font-semibold text-sm text-on-surface leading-tight line-clamp-2 mb-1 group-hover:text-primary transition-colors">
            {event.title}
          </h3>
          <p className="text-on-surface-variant text-xs font-body">
            {time}
            {event.venueName ? ` · ${event.venueName}` : ""}
          </p>
          <div className="flex items-center justify-between mt-2">
            <span
              className="text-[0.6rem] font-body font-medium"
              style={{ color: categoryColor }}
            >
              {categoryLabel}
            </span>
            <span className="text-xs font-body text-on-surface-variant">
              {event.isFree ? "Free Admission" : event.price ?? ""}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
