export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { getFollowSets, getFollowedEvents } from "@/lib/follows";
import { prisma } from "@/lib/prisma";
import { CATEGORY_LABELS } from "@/lib/types";
import type { EventSummary } from "@/lib/types";
import { sfDayKey } from "@/lib/sfDate";
import DateGroup from "@/components/events/DateGroup";
import FollowButton from "@/components/events/FollowButton";

export const metadata: Metadata = {
  title: "following — happening",
  description: "Events from the venues, categories, and artists you follow.",
};

/** Title-case a lowercased artist key for display ("four tet" → "Four Tet"). */
function displayArtist(name: string): string {
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function FollowingPage() {
  const user = await getSessionUser();

  // Following is account-bound; anonymous visitors get a sign-in nudge.
  if (!user) {
    return (
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-16">
        <div className="flex flex-col items-center justify-center text-center gap-5">
          <h1 className="font-headline font-black text-3xl text-on-surface lowercase">following</h1>
          <p className="font-body text-sm text-on-surface-variant max-w-sm">
            sign in to follow venues, categories, and artists &mdash; then this page collects every
            upcoming event from the ones you care about.
          </p>
          <Link href="/login" className="btn-primary px-6 py-3 text-sm">
            sign in
          </Link>
        </div>
      </div>
    );
  }

  const [sets, events] = await Promise.all([
    getFollowSets(user.id),
    getFollowedEvents(user.id),
  ]);

  const venues = sets.venueIds.length
    ? await prisma.venue.findMany({
        where: { id: { in: sets.venueIds } },
        select: { id: true, name: true },
      })
    : [];

  const followsEmpty =
    sets.venueIds.length === 0 && sets.categories.length === 0 && sets.artists.size === 0;

  // Group followed events by SF day, like the home feed.
  const grouped: Record<string, EventSummary[]> = {};
  for (const e of events) {
    const dk = sfDayKey(new Date(e.startDate));
    (grouped[dk] ??= []).push(e);
  }
  const days = Object.keys(grouped).sort();

  return (
    <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <h1 className="font-headline font-black text-3xl sm:text-4xl text-on-surface lowercase mb-6">
        following
      </h1>

      {/* What you follow — chips with unfollow */}
      {!followsEmpty && (
        <div className="flex flex-wrap gap-2 mb-8">
          {venues.map((v) => (
            <FollowButtonChip key={`venue-${v.id}`} type="VENUE" id={v.id} label={v.name} />
          ))}
          {sets.categories.map((c) => (
            <FollowButtonChip key={`cat-${c}`} type="CATEGORY" id={c} label={CATEGORY_LABELS[c] ?? c} />
          ))}
          {[...sets.artists].map((a) => (
            <FollowButtonChip key={`artist-${a}`} type="ARTIST" id={a} label={displayArtist(a)} />
          ))}
        </div>
      )}

      {followsEmpty ? (
        <div className="flex flex-col items-center justify-center text-center gap-4 py-16">
          <p className="font-headline font-bold text-xl text-on-surface lowercase">
            you&rsquo;re not following anything yet
          </p>
          <p className="font-body text-sm text-on-surface-variant max-w-sm">
            tap <span className="font-semibold">follow</span> on a venue, category, or artist from any
            event page and its upcoming events will show up here.
          </p>
          <Link href="/" className="btn-secondary px-5 py-2.5 text-sm">
            explore events
          </Link>
        </div>
      ) : days.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center gap-4 py-16">
          <p className="font-headline font-bold text-xl text-on-surface lowercase">
            nothing coming up
          </p>
          <p className="font-body text-sm text-on-surface-variant max-w-sm">
            none of the venues, categories, or artists you follow have upcoming events in the next
            few weeks. check back soon.
          </p>
        </div>
      ) : (
        days.map((dayKey) => (
          <DateGroup
            key={dayKey}
            dayKey={dayKey}
            date={new Date(dayKey + "T12:00:00Z")}
            events={grouped[dayKey]}
            initialHasMore={false}
            totalCount={grouped[dayKey].length}
          />
        ))
      )}
    </div>
  );
}

/** Server-rendered chip wrapping the client FollowButton, pre-set to "following". */
function FollowButtonChip({
  type,
  id,
  label,
}: {
  type: "VENUE" | "CATEGORY" | "ARTIST";
  id: string;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 bg-surface-container rounded-full pl-3 pr-1.5 py-1">
      <span className="font-body text-xs text-on-surface">{label}</span>
      <FollowButton
        targetType={type}
        targetId={id}
        label={label}
        isSignedIn
        initialFollowing
      />
    </span>
  );
}
