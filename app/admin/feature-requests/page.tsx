export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { format } from "date-fns";
import FeatureRequestActions from "./FeatureRequestActions";

interface Props {
  searchParams: Promise<{ secret?: string }>;
}

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

export default async function FeatureRequestsPage({ searchParams }: Props) {
  const { secret } = await searchParams;

  if (!secret || secret !== process.env.SCRAPE_SECRET) {
    return (
      <div className="max-w-screen-md mx-auto px-6 py-16 text-center">
        <p className="font-body text-on-surface-variant">Access denied.</p>
      </div>
    );
  }

  const requests = await prisma.featuredRequest.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="font-headline font-black text-3xl text-on-surface lowercase">
          feature requests
        </h1>
        <p className="font-body text-on-surface-variant text-sm mt-1">
          {requests.length} request{requests.length !== 1 ? "s" : ""} received
        </p>
      </div>

      {requests.length === 0 ? (
        <p className="font-body text-on-surface-variant">No requests yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {requests.map((req) => (
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

              {req.eventUrl && (
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
                  <FeatureRequestActions id={req.id} status={req.status} secret={secret} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
