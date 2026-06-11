/**
 * Weekly "this weekend in SF" email digest (issue #97).
 *
 * Pure selection + rendering helpers shared by the cron sender
 * (scripts/send-weekly-digest.ts). Everything here is side-effect free: the
 * script owns the database reads/writes and the Resend call, so this module
 * stays easy to reason about and unit-test.
 *
 * The digest has two parts, mirroring the home page:
 *   1. Featured picks — the auto-feature editorial set for the weekend (falls
 *      back to the highest-interest weekend events when nothing is featured).
 *   2. Picked for you — weekend events matching the categories/neighbourhoods
 *      the reader has hearted (issue #96 attributes hearts to accounts). Empty
 *      for readers with no history, who still get the featured picks.
 */
import { CATEGORY_LABELS } from "@/lib/types";
import { formatDateTimeSF, formatDateShortSF, sfDayKey, sfDayStart, sfDayEnd } from "@/lib/sfDate";

const SF_TZ = "America/Los_Angeles";

// Minimal column set every digest section needs. Shared so the cron query and
// the render functions agree on shape.
export const DIGEST_EVENT_SELECT = {
  id: true,
  title: true,
  startDate: true,
  endDate: true,
  allDay: true,
  venueName: true,
  neighborhood: true,
  category: true,
  isFree: true,
  price: true,
  featured: true,
  externalInterest: true,
  _count: { select: { interests: true } },
} as const;

export interface DigestEvent {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date | null;
  allDay: boolean;
  venueName: string | null;
  neighborhood: string | null;
  category: string | null;
  isFree: boolean;
  price: string | null;
  featured: boolean;
  externalInterest: number;
  _count: { interests: number };
}

export interface ReaderPrefs {
  categories: Set<string>;
  neighborhoods: Set<string>;
}

const interestOf = (e: DigestEvent) => e._count.interests + e.externalInterest;

// 0=Sun … 6=Sat in SF local time.
function sfWeekday(date: Date): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: SF_TZ, weekday: "short" }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(short);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * The Friday→Sunday window for "this weekend" in SF, as UTC instants.
 *
 * Run Mon–Fri it points at the coming Fri/Sat/Sun; run on the weekend itself it
 * stays on the current weekend (Friday is in the past). Calendar arithmetic runs
 * on UTC date parts — same trick as sfDate.isTomorrowSF — then sfDayStart/End
 * recompute the SF offset per date, so the window is correct across DST.
 */
export function weekendWindow(now: Date): { start: Date; end: Date; label: string } {
  const wd = sfWeekday(now);
  const daysToFriday = wd === 0 ? -2 : wd === 6 ? -1 : 5 - wd; // Sun/Sat already in-weekend

  const [y, m, d] = sfDayKey(now).split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const keyAt = (offsetDays: number) => {
    const x = new Date(base);
    x.setUTCDate(base.getUTCDate() + offsetDays);
    return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
  };

  const start = sfDayStart(keyAt(daysToFriday));
  const end = sfDayEnd(keyAt(daysToFriday + 2));
  const label = `${formatDateShortSF(start)} – ${formatDateShortSF(end)}`;
  return { start, end, label };
}

/** Categories and neighbourhoods the reader has hearted, from their interest rows. */
export function readerPrefs(
  interests: { event: { category: string | null; neighborhood: string | null } }[]
): ReaderPrefs {
  const categories = new Set<string>();
  const neighborhoods = new Set<string>();
  for (const { event } of interests) {
    if (event.category) categories.add(event.category);
    if (event.neighborhood) neighborhoods.add(event.neighborhood);
  }
  return { categories, neighborhoods };
}

/**
 * The weekend's editorial picks: the auto-feature set, newest-first by start.
 * Falls back to the highest-interest weekend events when nothing is featured, so
 * the digest is never empty as long as there are events.
 */
export function featuredPicks(weekend: DigestEvent[], limit = 6): DigestEvent[] {
  const featured = weekend
    .filter((e) => e.featured)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  if (featured.length) return featured.slice(0, limit);
  return [...weekend].sort((a, b) => interestOf(b) - interestOf(a)).slice(0, limit);
}

/**
 * Weekend events matching the reader's hearted categories/neighbourhoods,
 * excluding anything already shown in `exclude` (the featured picks). Ranked by
 * interest, then soonest. Empty when the reader has no history or no matches.
 */
export function personalizedPicks(
  weekend: DigestEvent[],
  prefs: ReaderPrefs,
  exclude: DigestEvent[],
  limit = 6
): DigestEvent[] {
  if (!prefs.categories.size && !prefs.neighborhoods.size) return [];
  const excluded = new Set(exclude.map((e) => e.id));
  return weekend
    .filter((e) => !excluded.has(e.id))
    .filter(
      (e) =>
        (e.category && prefs.categories.has(e.category)) ||
        (e.neighborhood && prefs.neighborhoods.has(e.neighborhood))
    )
    .sort((a, b) => interestOf(b) - interestOf(a) || a.startDate.getTime() - b.startDate.getTime())
    .slice(0, limit);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function eventRow(e: DigestEvent, baseUrl: string): string {
  const when = e.allDay ? formatDateShortSF(e.startDate) : formatDateTimeSF(e.startDate);
  const meta = [
    e.category ? CATEGORY_LABELS[e.category] ?? null : null,
    e.neighborhood,
    e.isFree ? "Free" : e.price,
  ]
    .filter(Boolean)
    .join(" · ");
  const venue = e.venueName ? ` · ${esc(e.venueName)}` : "";
  return `
    <a href="${baseUrl}/events/${e.id}" style="display:block;text-decoration:none;color:inherit;padding:16px 0;border-bottom:1px solid #eee">
      <div style="font-size:16px;font-weight:700;color:#000;margin:0 0 4px">${esc(e.title)}</div>
      <div style="font-size:13px;color:#888">${esc(when)}${venue}</div>
      ${meta ? `<div style="font-size:12px;color:#aaa;margin-top:2px">${esc(meta)}</div>` : ""}
    </a>`;
}

function section(title: string, events: DigestEvent[], baseUrl: string): string {
  if (!events.length) return "";
  return `
    <h3 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#888;margin:32px 0 0">${esc(title)}</h3>
    ${events.map((e) => eventRow(e, baseUrl)).join("")}`;
}

export interface RenderArgs {
  weekendLabel: string;
  picks: DigestEvent[];
  personalized: DigestEvent[];
  curatorNote: string | null;
  baseUrl: string;
  unsubscribeToken: string;
}

export function digestSubject(args: Pick<RenderArgs, "picks" | "weekendLabel">): string {
  const top = args.picks[0];
  if (!top) return `This weekend in SF · ${args.weekendLabel}`;
  const rest = args.picks.length - 1;
  return rest > 0
    ? `This weekend in SF: ${top.title} + ${rest} more`
    : `This weekend in SF: ${top.title}`;
}

export function renderDigestEmail(args: RenderArgs): string {
  const { weekendLabel, picks, personalized, curatorNote, baseUrl, unsubscribeToken } = args;
  const unsubscribeUrl = `${baseUrl}/api/unsubscribe?token=${unsubscribeToken}`;
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
      <h2 style="font-size:24px;font-weight:900;margin:0 0 4px">happening</h2>
      <p style="color:#888;font-size:13px;margin:0 0 24px">This weekend in SF · ${esc(weekendLabel)}</p>
      ${curatorNote ? `<p style="font-size:15px;line-height:1.5;color:#333;margin:0 0 8px">${esc(curatorNote)}</p>` : ""}
      ${section("Featured this weekend", picks, baseUrl)}
      ${section("Picked for you", personalized, baseUrl)}
      <p style="font-size:13px;margin:32px 0 0">
        <a href="${baseUrl}" style="color:#000;font-weight:700;text-decoration:none">See everything on happening →</a>
      </p>
      <p style="font-size:11px;color:#aaa;margin:32px 0 0;line-height:1.5">
        You're getting this because you have a happening account.
        <a href="${unsubscribeUrl}" style="color:#aaa">Unsubscribe</a> from the weekly digest.
      </p>
    </div>`;
}
