export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { CATEGORY_LABELS, CATEGORY_COLORS } from "@/lib/types";
import { CATEGORY_IMAGES } from "@/lib/categoryImages";
import { formatDateLongSF, formatTimeSF, formatDateShortSF } from "@/lib/sfDate";
import { ArrowLeft, Clock, MapPin, ExternalLink, Tag } from "lucide-react";
import FeaturedToggle from "@/app/admin/submissions/FeaturedToggle";
import ShareButton from "./ShareButton";

/** Extract a venue hint from a title like "...at Ocean Beach" or "...in Golden Gate Park" */
function extractLocationFromTitle(title: string): string | null {
  const match = title.match(/\b(?:at|in)\s+([a-z][a-z\s']+?)(?:\s+on\b|\s+this\b|\s*$)/i);
  if (!match) return null;
  const candidate = match[1].trim();
  // Skip generic/short phrases
  if (candidate.split(" ").length < 2 && candidate.length < 6) return null;
  return candidate.replace(/\b\w/g, (c) => c.toUpperCase());
}

async function getEvent(id: string) {
  return prisma.event.findUnique({
    where: { id },
    include: { source: { select: { slug: true, name: true, url: true } } },
  });
}

async function getSimilarEvents(event: NonNullable<Awaited<ReturnType<typeof getEvent>>>) {
  return prisma.event.findMany({
    where: {
      id: { not: event.id },
      startDate: { gte: new Date() },
      OR: [
        { category: event.category ?? undefined },
        { neighborhood: event.neighborhood ?? undefined },
      ],
    },
    take: 3,
    orderBy: { startDate: "asc" },
    select: {
      id: true,
      title: true,
      startDate: true,
      imageUrl: true,
      category: true,
      venueName: true,
    },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const event = await getEvent(id);
  if (!event) return {};

  const dateLabel = formatDateLongSF(event.startDate);
  const timeLabel = formatTimeSF(event.startDate);
  const venueDisplayName = event.venueName ?? extractLocationFromTitle(event.title);

  const parts = [`${dateLabel} at ${timeLabel}`];
  if (venueDisplayName) parts.push(venueDisplayName);
  if (event.neighborhood) parts.push(event.neighborhood);
  if (event.description) parts.push(event.description.slice(0, 120).trim());
  const description = parts.join(" · ");

  const title = `${event.title} — happening`;
  const image = event.imageUrl ?? null;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      ...(image ? { images: [{ url: image, width: 1200, height: 630, alt: event.title }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ secret?: string }>;
}) {
  const [{ id }, { secret }] = await Promise.all([params, searchParams]);
  const isAdmin = secret && secret === process.env.SCRAPE_SECRET;
  const event = await getEvent(id);
  if (!event) notFound();

  const similar = await getSimilarEvents(event);

  const categoryLabel = event.category ? CATEGORY_LABELS[event.category] : null;
  const categoryColor = event.category ? CATEGORY_COLORS[event.category] : "#574142";
  const categoryImage = event.category ? (CATEGORY_IMAGES[event.category] ?? null) : null;
  const dateLabel = formatDateLongSF(event.startDate);
  const timeLabel = formatTimeSF(event.startDate);
  const endTimeLabel = event.endDate ? formatTimeSF(event.endDate) : null;
  const venueDisplayName = event.venueName ?? extractLocationFromTitle(event.title);
  const mapsQuery = event.venueAddress ?? (venueDisplayName ? `${venueDisplayName}, San Francisco, CA` : null);

  return (
    <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Admin bar */}
      {isAdmin && (
        <div className="mb-4 flex items-center gap-3 bg-surface-container-high rounded-xl px-4 py-3">
          <span className="font-body text-xs text-on-surface-variant">admin</span>
          <FeaturedToggle id={event.id} featured={event.featured} secret={secret!} />
        </div>
      )}

      {/* Back nav */}
      <div className="flex items-center justify-between mb-8">
        <Link
          href="/events"
          className="flex items-center gap-2 text-on-surface-variant hover:text-on-surface text-xs font-body uppercase tracking-widest transition-colors"
        >
          <ArrowLeft size={13} />
          Back to explore
        </Link>
        <ShareButton title={event.title} />
      </div>

      {/* Main grid: flyer left, details right */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 mb-12 lg:mb-16">
        {/* Flyer */}
        <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-surface-container">
          {event.imageUrl ? (
            <Image
              src={event.imageUrl}
              alt={event.title}
              fill
              className="object-cover"
              sizes="(max-width: 1024px) 100vw, 50vw"
              priority
            />
          ) : categoryImage ? (
            <Image
              src={categoryImage}
              alt={categoryLabel ?? event.title}
              fill
              className="object-cover"
              sizes="(max-width: 1024px) 100vw, 50vw"
              priority
            />
          ) : (
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(135deg, ${categoryColor}44, ${categoryColor}11)`,
              }}
            />
          )}
          {/* Tags overlay */}
          {event.tags.length > 0 && (
            <div className="absolute bottom-4 left-4 flex flex-wrap gap-1.5">
              {event.tags.slice(0, 4).map((tag: string) => (
                <span key={tag} className="chip text-[0.6rem]">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="flex flex-col">
          {/* Category + neighborhood chips */}
          <div className="flex flex-wrap gap-2 mb-4">
            {categoryLabel && (
              <span
                className="chip"
                style={{ background: `${categoryColor}22`, color: categoryColor }}
              >
                {categoryLabel}
              </span>
            )}
            {event.neighborhood && (
              <span className="chip">{event.neighborhood}</span>
            )}
            <span className="chip text-on-surface-variant">{event.source.name}</span>
          </div>

          {/* Title */}
          <h1 className="font-headline font-black text-4xl lg:text-5xl text-on-surface lowercase leading-tight mb-6">
            {event.title}
          </h1>

          {/* Date / time / price */}
          <div className="flex flex-wrap gap-3 mb-6">
            <span className="bg-surface-container rounded-DEFAULT px-3 py-1.5 text-xs font-body text-on-surface flex items-center gap-1.5">
              <Clock size={12} className="text-primary" />
              {dateLabel}
            </span>
            <span className="bg-surface-container rounded-DEFAULT px-3 py-1.5 text-xs font-body text-on-surface flex items-center gap-1.5">
              <Clock size={12} className="text-primary" />
              {timeLabel}{endTimeLabel ? ` – ${endTimeLabel}` : ""}
            </span>
          </div>

          {/* Price + availability */}
          <div className="flex items-baseline gap-3 mb-8">
            <span className="font-headline font-bold text-3xl text-on-surface">
              {event.isFree ? "Free" : event.price ?? "See site"}
            </span>
          </div>

          {/* CTA buttons */}
          <div className="flex flex-col gap-3 mb-8">
            <a
              href={event.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary text-center py-3.5 text-sm flex items-center justify-center gap-2"
            >
              get your tickets
              <ExternalLink size={13} />
            </a>
            <ShareButton title={event.title} large />
          </div>

          {/* Vibe / description */}
          {event.description && (
            <div className="mb-8">
              <h2 className="font-headline font-bold text-lg text-on-surface lowercase mb-3">
                the vibe
              </h2>
              <p className="font-body text-on-surface-variant text-sm leading-relaxed">
                {event.description}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* The Spot (venue) */}
      {(venueDisplayName || event.venueAddress) && (
        <div className="mb-16">
          <h2 className="font-headline font-bold text-2xl text-on-surface lowercase mb-6">
            the spot
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-surface-container rounded-lg p-6">
              <div className="flex items-start gap-3">
                <MapPin size={16} className="text-primary mt-0.5 shrink-0" />
                <div>
                  {venueDisplayName && (
                    <p className="font-body font-semibold text-on-surface text-sm">
                      {venueDisplayName}
                    </p>
                  )}
                  {event.venueAddress && (
                    <p className="font-body text-on-surface-variant text-xs mt-0.5">
                      {event.venueAddress}
                    </p>
                  )}
                </div>
              </div>
              {mapsQuery && (
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent(mapsQuery)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 flex items-center gap-1.5 text-xs font-body text-primary hover:opacity-80 transition-opacity uppercase tracking-wider"
                >
                  <ExternalLink size={11} />
                  open in maps
                </a>
              )}
            </div>

            {/* Mini map placeholder — if lat/lon exists, shows map pin */}
            {event.venueAddress && event.latitude && event.longitude && (
              <div className="relative rounded-lg overflow-hidden bg-surface-container h-40">
                <iframe
                  title="venue map"
                  className="absolute inset-0 w-full h-full opacity-70"
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${event.longitude - 0.005}%2C${event.latitude - 0.005}%2C${event.longitude + 0.005}%2C${event.latitude + 0.005}&layer=mapnik&marker=${event.latitude}%2C${event.longitude}`}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Similar events */}
      {similar.length > 0 && (
        <div>
          <h2 className="font-headline font-bold text-2xl text-on-surface lowercase mb-6">
            similar pulses
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {similar.map((e: typeof similar[number]) => {
              const cat = e.category ? CATEGORY_COLORS[e.category] : "#574142";
              return (
                <Link
                  key={e.id}
                  href={`/events/${e.id}`}
                  className="group bg-surface-container rounded-lg overflow-hidden hover:bg-surface-container-high transition-colors"
                >
                  <div className="relative aspect-video bg-surface-container-high">
                    {e.imageUrl ? (
                      <Image
                        src={e.imageUrl}
                        alt={e.title}
                        fill
                        className="object-cover transition-transform duration-500 group-hover:scale-105"
                        sizes="33vw"
                      />
                    ) : (
                      <div
                        className="absolute inset-0"
                        style={{
                          background: `linear-gradient(135deg, ${cat}33, ${cat}11)`,
                        }}
                      />
                    )}
                    <div className="absolute top-2 left-2">
                      <span className="chip text-[0.6rem]">
                        {formatDateShortSF(e.startDate)}
                      </span>
                    </div>
                  </div>
                  <div className="p-4">
                    <p className="font-body font-semibold text-sm text-on-surface line-clamp-2 group-hover:text-primary transition-colors">
                      {e.title}
                    </p>
                    <p className="font-body text-xs text-on-surface-variant mt-1">
                      {e.venueName ?? ""}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-20 pt-8 flex items-center justify-between text-on-surface-variant text-xs font-body">
        <span className="font-headline font-bold text-sm text-on-surface">happening</span>
        <span>
          via{" "}
          <a
            href={event.source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-on-surface transition-colors"
          >
            {event.source.name}
          </a>
        </span>
      </footer>
    </div>
  );
}
