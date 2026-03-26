export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { CATEGORY_LABELS } from "@/lib/types";
import { format } from "date-fns";
import AdminActions from "./AdminActions";

interface Props {
  searchParams: Promise<{ secret?: string }>;
}

export default async function SubmissionsPage({ searchParams }: Props) {
  const { secret } = await searchParams;

  if (!secret || secret !== process.env.SCRAPE_SECRET) {
    return (
      <div className="max-w-screen-md mx-auto px-6 py-16 text-center">
        <p className="font-body text-on-surface-variant">Access denied.</p>
      </div>
    );
  }

  const events = await prisma.event.findMany({
    where: { status: "PENDING" },
    orderBy: { scrapedAt: "desc" },
    select: {
      id: true,
      title: true,
      startDate: true,
      venueName: true,
      venueAddress: true,
      neighborhood: true,
      category: true,
      price: true,
      isFree: true,
      description: true,
      sourceUrl: true,
      tags: true,
      submitterNote: true,
      scrapedAt: true,
    },
  });

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="font-headline font-black text-3xl text-on-surface lowercase">
          pending submissions
        </h1>
        <p className="font-body text-on-surface-variant text-sm mt-1">
          {events.length} event{events.length !== 1 ? "s" : ""} awaiting review
        </p>
      </div>

      {events.length === 0 ? (
        <p className="font-body text-on-surface-variant">Nothing to review.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {events.map((event) => (
            <div
              key={event.id}
              className="bg-surface-container rounded-2xl p-5 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h2 className="font-headline font-bold text-lg text-on-surface leading-tight">
                    {event.title}
                  </h2>
                  <p className="font-body text-on-surface-variant text-sm mt-0.5">
                    {format(event.startDate, "EEE, MMM d yyyy")}
                    {event.venueName && ` · ${event.venueName}`}
                    {event.neighborhood && ` · ${event.neighborhood}`}
                  </p>
                </div>
                {event.category && (
                  <span className="chip shrink-0 text-xs">
                    {CATEGORY_LABELS[event.category] ?? event.category}
                  </span>
                )}
              </div>

              {event.description && (
                <p className="font-body text-on-surface text-sm">{event.description}</p>
              )}

              <div className="flex flex-wrap gap-2 text-xs font-body text-on-surface-variant">
                {event.price && <span>{event.price}</span>}
                {event.isFree && <span>Free</span>}
                {event.venueAddress && <span>{event.venueAddress}</span>}
                {event.tags.map((t) => (
                  <span key={t} className="chip">
                    {t}
                  </span>
                ))}
              </div>

              {event.submitterNote && (
                <p className="font-body text-on-surface-variant text-xs italic">
                  Note: {event.submitterNote}
                </p>
              )}

              <div className="flex items-center gap-3 mt-1">
                <a
                  href={event.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-body text-xs text-on-surface-variant hover:text-on-surface underline truncate max-w-xs"
                >
                  {event.sourceUrl}
                </a>
                <span className="font-body text-xs text-on-surface-variant ml-auto">
                  submitted {format(event.scrapedAt, "MMM d h:mma")}
                </span>
              </div>

              <AdminActions id={event.id} secret={secret} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
