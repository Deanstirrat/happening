"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Music, Repeat, Clock } from "lucide-react";

const WEEKDAY_SHORT: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function toSFDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(date);
}

function getSFDayOfWeek(date: Date): number {
  const str = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
  }).format(date);
  return WEEKDAY_SHORT[str] ?? 0;
}

function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export default function TimeFilterTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const now = new Date();
  const todayKey = toSFDateKey(now);
  const dow = getSFDayOfWeek(now);

  // Find this weekend: nearest Sat/Sun pair (or current day if already on it)
  const daysToSat = dow === 6 ? 0 : dow === 0 ? -1 : 6 - dow;
  const satKey = addDaysToKey(todayKey, daysToSat);
  const sunKey = addDaysToKey(satKey, 1);

  const currentStart = searchParams.get("startDate");
  const currentEnd = searchParams.get("endDate");
  const hideMusic = searchParams.get("hideMusic") === "true";
  const hideRecurring = searchParams.get("hideRecurring") === "true";
  const sortByTime = searchParams.get("sort") === "time";

  const isTonightActive = currentStart === todayKey && currentEnd === todayKey;
  const isWeekendActive = currentStart === satKey && currentEnd === sunKey;

  function navigate(start: string, end: string, isActive: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (isActive) {
      params.delete("startDate");
      params.delete("endDate");
    } else {
      params.set("startDate", start);
      params.set("endDate", end);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function toggleHideMusic() {
    const params = new URLSearchParams(searchParams.toString());
    if (hideMusic) {
      params.delete("hideMusic");
    } else {
      params.set("hideMusic", "true");
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function toggleHideRecurring() {
    const params = new URLSearchParams(searchParams.toString());
    if (hideRecurring) {
      params.delete("hideRecurring");
    } else {
      params.set("hideRecurring", "true");
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  // Default ordering surfaces higher-signal events first; this opts back into
  // pure chronological order.
  function toggleSortByTime() {
    const params = new URLSearchParams(searchParams.toString());
    if (sortByTime) {
      params.delete("sort");
    } else {
      params.set("sort", "time");
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex gap-2 flex-wrap">
      <button
        onClick={() => navigate(todayKey, todayKey, isTonightActive)}
        className={`chip text-[0.7rem] uppercase tracking-wider font-semibold${isTonightActive ? " active" : ""}`}
      >
        Tonight
      </button>
      <button
        onClick={() => navigate(satKey, sunKey, isWeekendActive)}
        className={`chip text-[0.7rem] uppercase tracking-wider font-semibold${isWeekendActive ? " active" : ""}`}
      >
        This Weekend
      </button>
      <button
        onClick={toggleHideMusic}
        className={`chip text-[0.7rem] uppercase tracking-wider font-semibold flex items-center gap-1${hideMusic ? " active" : ""}`}
      >
        <Music size={11} />
        Hide Music
      </button>
      <button
        onClick={toggleHideRecurring}
        className={`chip text-[0.7rem] uppercase tracking-wider font-semibold flex items-center gap-1${hideRecurring ? " active" : ""}`}
      >
        <Repeat size={11} />
        Hide Recurring
      </button>
      <button
        onClick={toggleSortByTime}
        className={`chip text-[0.7rem] uppercase tracking-wider font-semibold flex items-center gap-1${sortByTime ? " active" : ""}`}
      >
        <Clock size={11} />
        Chronological
      </button>
    </div>
  );
}
