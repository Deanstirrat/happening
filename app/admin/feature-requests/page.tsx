export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { format } from "date-fns";
import FeatureRequestActions from "./FeatureRequestActions";
import AdminNav from "../_components/AdminNav";
import Link from "next/link";
import { getAdminUser } from "@/lib/auth";
import { redirect } from "next/navigation";

const STATUS_LABELS = {
  NEW: "new",
  CONTACTED: "contacted",
  CLOSED: "closed",
};

const STATUS_COLORS = {
  NEW: "text-[#4ade80]",
  CONTACTED: "text-[#60a5fa]",
  CLOSED: "text-on-surface-variant",
};

const FIELD_LABELS: Record<string, string> = {
  description: "Description",
  tags: "Tags",
  price: "Price",
  venueName: "Venue",
  sourceUrl: "Source URL",
};

export default async function FeatureRequestsPage() {
  if (!(await getAdminUser())) redirect("/login");

  const requests = await prisma.featuredRequest.findMany({
    orderBy: { createdAt: "desc" },
  });

  // Fetch linked events for requests that have eventId
  const eventIds = requests.map((r) => r.eventId).filter(Boolean) as string[];
  const events = eventIds.length > 0
    ? await prisma.event.findMany({
        where: { id: { in: eventIds } },
        select: {
          id: true,
          title: true,
          startDate: true,
          venueName: true,
          description: true,
          tags: true,
          price: true,
          sourceUrl: true,
          featured: true,
        },
      })
    : [];
  const eventMap = new Map(events.map((e) => [e.id, e]));

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-8 flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <h1 className="font-headline font-black text-3xl text-on-surface lowercase">feature requests</h1>
        <AdminNav current="feature-requests" />
      </div>

      <div>
        <p className="font-body text-on-surface-variant text-sm mb-6">
          {requests.length} request{requests.length !== 1 ? "s" : ""} received
        </p>

        {requests.length === 0 ? (
          <p className="font-body text-on-surface-variant">No requests yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {requests.map((req) => {
              const linkedEvent = req.eventId ? eventMap.get(req.eventId) : null;
              const edits = (req.suggestedEdits as Record<string, string> | null) ?? null;

              return (
                <div
                  key={req.id}
                  className="bg-surface-container rounded-2xl p-5 flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h2 className="font-headline font-bold text-lg text-on-surface leading-tight">
                        {req.eventName}
                      </h2>
                      <p className="font-body text-on-surface-variant text-sm mt-0.5">
                        {req.name} · {req.email}
                        {req.eventDate && ` · ${req.eventDate}`}
                      </p>
                    </div>
                    <span className={`font-body text-xs font-semibold shrink-0 ${STATUS_COLORS[req.status]}`}>
                      {STATUS_LABELS[req.status]}
                    </span>
                  </div>

                  <p className="font-body text-sm text-on-surface">{req.message}</p>

                  {/* Linked event info */}
                  {linkedEvent && (
                    <div className="bg-surface-container-high rounded-xl p-3 flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-body text-xs text-on-surface-variant uppercase tracking-wider">
                          linked event
                        </span>
                        {linkedEvent.featured && (
                          <span className="font-body text-xs text-primary font-semibold">
                            already featured
                          </span>
                        )}
                      </div>
                      <Link
                        href={`/events/${linkedEvent.id}`}
                        className="font-body text-sm text-on-surface hover:text-primary transition-colors underline"
                      >
                        {linkedEvent.title} · {format(linkedEvent.startDate, "MMM d yyyy")}
                        {linkedEvent.venueName && ` · ${linkedEvent.venueName}`}
                      </Link>
                    </div>
                  )}

                  {/* Suggested edits diff */}
                  {edits && linkedEvent && Object.keys(edits).length > 0 && (
                    <div className="bg-surface-container-high rounded-xl p-3 flex flex-col gap-2">
                      <span className="font-body text-xs text-on-surface-variant uppercase tracking-wider">
                        suggested edits
                      </span>
                      <div className="flex flex-col gap-1.5">
                        {Object.entries(edits).map(([field, suggested]) => {
                          const currentVal = field === "tags"
                            ? (linkedEvent.tags?.join(", ") ?? "")
                            : String((linkedEvent as Record<string, unknown>)[field] ?? "");
                          return (
                            <div key={field} className="font-body text-xs">
                              <span className="text-on-surface-variant font-medium">
                                {FIELD_LABELS[field] ?? field}:
                              </span>{" "}
                              {currentVal ? (
                                <>
                                  <span className="text-on-surface-variant line-through">
                                    {currentVal.length > 80 ? `${currentVal.slice(0, 80)}...` : currentVal}
                                  </span>
                                  {" → "}
                                </>
                              ) : (
                                <span className="text-on-surface-variant italic">empty → </span>
                              )}
                              <span className="text-[#4ade80]">
                                {suggested.length > 80 ? `${suggested.slice(0, 80)}...` : suggested}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {req.eventUrl && !linkedEvent && (
                    <a
                      href={req.eventUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-body text-xs text-on-surface-variant hover:text-on-surface underline truncate max-w-xs w-fit"
                    >
                      {req.eventUrl}
                    </a>
                  )}

                  <div className="flex items-center gap-3">
                    <span className="font-body text-xs text-on-surface-variant">
                      {format(req.createdAt, "MMM d yyyy, h:mma")}
                    </span>
                    <div className="ml-auto">
                      <FeatureRequestActions
                        id={req.id}
                        status={req.status}
                        hasLinkedEvent={!!linkedEvent && !linkedEvent.featured}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
