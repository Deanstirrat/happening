export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import EditEventForm from "./EditEventForm";
import FeaturedToggle from "@/app/admin/submissions/FeaturedToggle";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ secret?: string }>;
}

export default async function EditEventPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { secret } = await searchParams;

  if (!secret || secret !== process.env.SCRAPE_SECRET) {
    return (
      <div className="max-w-screen-md mx-auto px-6 py-16 text-center">
        <p className="font-body text-on-surface-variant">Access denied.</p>
      </div>
    );
  }

  const event = await prisma.event.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      startDate: true,
      endDate: true,
      venueName: true,
      venueAddress: true,
      neighborhood: true,
      category: true,
      price: true,
      isFree: true,
      tags: true,
      sourceUrl: true,
      imageUrl: true,
      status: true,
      featured: true,
    },
  });

  if (!event) {
    return (
      <div className="max-w-screen-md mx-auto px-6 py-16 text-center">
        <p className="font-body text-on-surface-variant">Event not found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-screen-md mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="font-headline font-black text-3xl text-on-surface lowercase">
          edit event
        </h1>
        <p className="font-body text-on-surface-variant text-sm mt-1 truncate">
          {event.title}
        </p>
      </div>
      <div className="mb-6 flex items-center gap-3">
        <span className="font-body text-sm text-on-surface-variant">Featured:</span>
        <FeaturedToggle id={event.id} featured={event.featured} secret={secret} />
      </div>
      <EditEventForm event={event} secret={secret} />
    </div>
  );
}
