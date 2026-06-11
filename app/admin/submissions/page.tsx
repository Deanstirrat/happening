export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { CATEGORY_LABELS } from "@/lib/types";
import { format } from "date-fns";
import AdminActions from "./AdminActions";
import FeaturedToggle from "./FeaturedToggle";
import SubmissionImageEdit from "./SubmissionImageEdit";
import AdminNav from "../_components/AdminNav";
import { getAdminUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function SubmissionsPage() {
  if (!(await getAdminUser())) redirect("/login");

  const [events, featuredEvents, submissions] = await Promise.all([
    prisma.event.findMany({
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
        imageUrl: true,
      },
    }),
    prisma.event.findMany({
      where: { status: "PUBLISHED", featured: true },
      orderBy: { featuredAt: "desc" },
      select: {
        id: true,
        title: true,
        startDate: true,
        venueName: true,
        neighborhood: true,
        featured: true,
        featuredAt: true,
      },
    }),
    prisma.submission.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  // Look up current event statuses for submissions that created an event
  const createdEventIds = submissions
    .filter((s) => s.outcome === "CREATED" && s.eventId)
    .map((s) => s.eventId as string);
  const createdEvents = createdEventIds.length
    ? await prisma.event.findMany({
        where: { id: { in: createdEventIds } },
        select: { id: true, status: true },
      })
    : [];
  const eventStatusById = Object.fromEntries(createdEvents.map((e) => [e.id, e.status]));

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-8 flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <h1 className="font-headline font-black text-3xl text-on-surface lowercase">submissions</h1>
        <AdminNav current="submissions" />
      </div>

      {/* Pending submissions */}
      <section>
        <div className="mb-8">
          <h2 className="font-headline font-bold text-xl text-on-surface lowercase">
            pending submissions
          </h2>
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

                <SubmissionImageEdit id={event.id} imageUrl={event.imageUrl} />

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

                <AdminActions id={event.id} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Submission history */}
      <section>
        <div className="mb-6">
          <h2 className="font-headline font-bold text-xl text-on-surface lowercase">
            submission history
          </h2>
          <p className="font-body text-on-surface-variant text-sm mt-1">
            last {submissions.length} submission{submissions.length !== 1 ? "s" : ""}
          </p>
        </div>

        {submissions.length === 0 ? (
          <p className="font-body text-on-surface-variant">No submissions yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {submissions.map((sub) => {
              const eventStatus = sub.eventId ? eventStatusById[sub.eventId] : null;
              return (
                <div
                  key={sub.id}
                  className="bg-surface-container rounded-2xl px-5 py-4 flex items-start gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-body font-semibold text-sm text-on-surface truncate">
                      {sub.title}
                    </p>
                    <p className="font-body text-on-surface-variant text-xs mt-0.5">
                      {sub.startDate ? format(sub.startDate, "EEE, MMM d yyyy") : "unknown date"}
                      {sub.submitterNote && ` · "${sub.submitterNote}"`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {sub.outcome === "DUPLICATE" && (
                      <span className="font-body text-xs px-2.5 py-1 rounded-full bg-yellow-500/15 text-yellow-400">
                        duplicate
                      </span>
                    )}
                    {sub.outcome === "CREATED" && eventStatus === "PUBLISHED" && (
                      <span className="font-body text-xs px-2.5 py-1 rounded-full bg-[#4ade80]/15 text-[#4ade80]">
                        published
                      </span>
                    )}
                    {sub.outcome === "CREATED" && eventStatus === "PENDING" && (
                      <span className="font-body text-xs px-2.5 py-1 rounded-full bg-surface-container-low text-on-surface-variant">
                        pending
                      </span>
                    )}
                    {sub.outcome === "CREATED" && eventStatus === "REJECTED" && (
                      <span className="font-body text-xs px-2.5 py-1 rounded-full bg-[#ef4444]/15 text-[#ef4444]">
                        rejected
                      </span>
                    )}
                    {sub.outcome === "ERROR" && (
                      <span className="font-body text-xs px-2.5 py-1 rounded-full bg-[#ef4444]/15 text-[#ef4444]">
                        error
                      </span>
                    )}
                    <span className="font-body text-xs text-on-surface-variant">
                      {format(sub.createdAt, "MMM d h:mma")}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Featured events */}
      <section>
        <div className="mb-6">
          <h2 className="font-headline font-black text-2xl text-on-surface lowercase">
            featured events
          </h2>
          <p className="font-body text-on-surface-variant text-sm mt-1">
            {featuredEvents.length} event{featuredEvents.length !== 1 ? "s" : ""} currently featured
          </p>
        </div>

        {featuredEvents.length === 0 ? (
          <p className="font-body text-on-surface-variant text-sm">
            No events are featured. Approve and feature published events to pin them to the top of the explore page.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {featuredEvents.map((event) => (
              <div
                key={event.id}
                className="bg-surface-container rounded-2xl p-4 flex items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <h3 className="font-body font-semibold text-sm text-on-surface truncate">
                    {event.title}
                  </h3>
                  <p className="font-body text-on-surface-variant text-xs mt-0.5">
                    {format(event.startDate, "EEE, MMM d yyyy")}
                    {event.venueName && ` · ${event.venueName}`}
                    {event.neighborhood && ` · ${event.neighborhood}`}
                  </p>
                  {event.featuredAt && (
                    <p className="font-body text-on-surface-variant text-xs mt-0.5">
                      featured {format(event.featuredAt, "MMM d h:mma")}
                    </p>
                  )}
                </div>
                <FeaturedToggle id={event.id} featured={event.featured} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
