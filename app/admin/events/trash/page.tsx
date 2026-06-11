export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { CATEGORY_LABELS } from "@/lib/types";
import { format } from "date-fns";
import Link from "next/link";
import AdminNav from "../../_components/AdminNav";
import TrashActions from "./TrashActions";

interface Props {
  searchParams: Promise<{ secret?: string }>;
}

// Retention window after which the purge job hard-deletes a trashed event.
// Keep in sync with PURGE_AFTER_DAYS in scripts/purge-trashed-events.ts.
const PURGE_AFTER_DAYS = 30;

export default async function TrashPage({ searchParams }: Props) {
  const { secret } = await searchParams;

  if (!secret || secret !== process.env.SCRAPE_SECRET) {
    return (
      <div className="max-w-screen-md mx-auto px-6 py-16 text-center">
        <p className="font-body text-on-surface-variant">Access denied.</p>
      </div>
    );
  }

  const events = await prisma.event.findMany({
    where: { status: "TRASHED" },
    orderBy: { deletedAt: "desc" },
    select: {
      id: true,
      title: true,
      startDate: true,
      venueName: true,
      neighborhood: true,
      category: true,
      deletedAt: true,
    },
  });

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h1 className="font-headline font-black text-3xl text-on-surface lowercase">trash</h1>
        <AdminNav secret={secret} current="events" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link
            href={`/admin/events?secret=${secret}`}
            className="font-body text-sm text-on-surface-variant hover:text-on-surface transition-colors"
          >
            ← back to events
          </Link>
          <p className="font-body text-on-surface-variant text-sm">
            {events.length} trashed event{events.length !== 1 ? "s" : ""} · auto-purged after{" "}
            {PURGE_AFTER_DAYS} days
          </p>
        </div>
      </div>

      {events.length === 0 ? (
        <p className="font-body text-on-surface-variant">Trash is empty.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {events.map((event) => (
            <div
              key={event.id}
              className="bg-surface-container rounded-2xl px-5 py-4 flex items-center gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-body font-semibold text-sm text-on-surface truncate">
                    {event.title}
                  </h2>
                  {event.category && (
                    <span className="chip shrink-0 text-xs">
                      {CATEGORY_LABELS[event.category] ?? event.category}
                    </span>
                  )}
                </div>
                <p className="font-body text-on-surface-variant text-xs mt-0.5">
                  {format(event.startDate, "EEE, MMM d yyyy")}
                  {event.venueName && ` · ${event.venueName}`}
                  {event.neighborhood && ` · ${event.neighborhood}`}
                  {event.deletedAt && ` · trashed ${format(event.deletedAt, "MMM d")}`}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <TrashActions id={event.id} secret={secret} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
