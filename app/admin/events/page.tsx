export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { CATEGORY_LABELS } from "@/lib/types";
import { format } from "date-fns";
import Link from "next/link";
import { Suspense } from "react";
import DeleteButton from "./DeleteButton";
import BlockButton from "./BlockButton";
import EventSearch from "./EventSearch";
import { EventStatus } from "@prisma/client";
import AdminNav from "../_components/AdminNav";
import FeaturedToggle from "../submissions/FeaturedToggle";
import { getAdminUser } from "@/lib/auth";
import { redirect } from "next/navigation";

interface Props {
  searchParams: Promise<{ status?: string; q?: string; take?: string }>;
}

const STATUS_LABELS: Record<EventStatus, string> = {
  PENDING: "Pending",
  PUBLISHED: "Published",
  REJECTED: "Rejected",
  ARCHIVED: "Archived",
  TRASHED: "Trashed",
};

const STATUS_COLORS: Record<EventStatus, string> = {
  PENDING: "bg-[#f59e0b]/20 text-[#f59e0b]",
  PUBLISHED: "bg-[#4ade80]/20 text-[#4ade80]",
  REJECTED: "bg-[#ef4444]/15 text-[#ef4444]",
  ARCHIVED: "bg-[#6b7280]/20 text-[#6b7280]",
  TRASHED: "bg-[#ef4444]/15 text-[#ef4444]",
};

export default async function AdminEventsPage({ searchParams }: Props) {
  if (!(await getAdminUser())) redirect("/login");

  const { status, q, take: takeParam } = await searchParams;

  const statusFilter = status && Object.keys(STATUS_LABELS).includes(status)
    ? (status as EventStatus)
    : undefined;

  const search = q?.trim();
  const take = Math.max(parseInt(takeParam ?? "50", 10) || 50, 50);

  const rawEvents = await prisma.event.findMany({
    where: {
      // The default "All" view hides soft-deleted events; they live in /trash.
      ...(statusFilter ? { status: statusFilter } : { status: { not: "TRASHED" } }),
      ...(search ? {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { venueName: { contains: search, mode: "insensitive" } },
        ],
      } : {}),
    },
    orderBy: { startDate: "asc" },
    take: take + 1,
    select: {
      id: true,
      title: true,
      startDate: true,
      venueName: true,
      neighborhood: true,
      category: true,
      status: true,
      featured: true,
    },
  });

  const hasMore = rawEvents.length > take;
  const events = hasMore ? rawEvents.slice(0, take) : rawEvents;

  const trashCount = await prisma.event.count({ where: { status: "TRASHED" } });

  const tabs: Array<{ label: string; value: string }> = [
    { label: "All", value: "" },
    { label: "Published", value: "PUBLISHED" },
    { label: "Pending", value: "PENDING" },
    { label: "Rejected", value: "REJECTED" },
  ];

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h1 className="font-headline font-black text-3xl text-on-surface lowercase">events</h1>
        <AdminNav current="events" />
        <p className="font-body text-on-surface-variant text-sm">
          showing {events.length}{hasMore ? "+" : ""} event{events.length !== 1 ? "s" : ""}
          {statusFilter ? ` · ${STATUS_LABELS[statusFilter].toLowerCase()}` : ""}
          {search ? ` · "${search}"` : ""}
        </p>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2">
        {tabs.map((tab) => {
          const isActive = (tab.value === "" && !statusFilter) || tab.value === statusFilter;
          const params = new URLSearchParams();
          if (tab.value) params.set("status", tab.value);
          if (search) params.set("q", search);
          return (
            <Link
              key={tab.value}
              href={params.toString() ? `/admin/events?${params.toString()}` : `/admin/events`}
              className={`font-body text-sm px-4 py-1.5 rounded-full transition-colors ${
                isActive
                  ? "bg-on-surface text-surface font-semibold"
                  : "bg-surface-container text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
        <Link
          href={`/admin/events/trash`}
          className="ml-auto font-body text-sm px-4 py-1.5 rounded-full bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors flex items-center gap-1.5"
        >
          trash
          {trashCount > 0 && (
            <span className="bg-primary text-on-primary text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
              {trashCount}
            </span>
          )}
        </Link>
      </div>

      {/* Search */}
      <div>
        <Suspense>
          <EventSearch status={statusFilter} />
        </Suspense>
      </div>

      {events.length === 0 ? (
        <p className="font-body text-on-surface-variant">No events found.</p>
      ) : (
        <div className="flex flex-col gap-4">
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
                  <span className={`chip shrink-0 text-xs ${STATUS_COLORS[event.status]}`}>
                    {STATUS_LABELS[event.status]}
                  </span>
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
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <FeaturedToggle id={event.id} featured={event.featured} />
                <Link
                  href={`/admin/events/${event.id}/edit`}
                  className="font-body text-sm font-semibold px-4 py-1.5 rounded-full bg-surface-container-low text-on-surface-variant hover:text-on-surface transition-colors"
                >
                  Edit
                </Link>
                <BlockButton id={event.id} />
                <DeleteButton id={event.id} />
              </div>
            </div>
          ))}
        </div>
        {hasMore && (() => {
          const moreParams = new URLSearchParams();
          if (statusFilter) moreParams.set("status", statusFilter);
          if (search) moreParams.set("q", search);
          moreParams.set("take", String(take + 50));
          return (
            <Link
              href={`/admin/events?${moreParams.toString()}`}
              className="font-body text-sm font-semibold px-6 py-2 rounded-full bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors self-start"
            >
              Load more
            </Link>
          );
        })()}
        </div>
      )}
    </div>
  );
}
