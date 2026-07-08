/**
 * Weekly "this week in SF" email digest (issue #97).
 *
 * Pure selection + rendering helpers shared by the cron sender
 * (scripts/send-weekly-digest.ts). Everything here is side-effect free: the
 * script owns the database reads/writes and the Resend call, so this module
 * stays easy to reason about and unit-test.
 *
 * The digest has two parts, mirroring the home page:
 *   1. Featured picks — the auto-feature editorial set for the week (falls
 *      back to the highest-interest events of the week when nothing is featured).
 *   2. Picked for you — week events matching the categories/neighbourhoods
 *      the reader has hearted (issue #96 attributes hearts to accounts). Empty
 *      for readers with no history, who still get the featured picks.
 */
import { CATEGORY_LABELS } from "@/lib/types";
import { curationInterest } from "@/lib/ranking";
import { formatTimeSF, formatDateShortSF, sfDayKey, sfDayStart, sfDayEnd } from "@/lib/sfDate";

const SF_TZ = "America/Los_Angeles";

// Minimal column set every digest section needs. Shared so the cron query and
// the render functions agree on shape.
export const DIGEST_EVENT_SELECT = {
  id: true,
  title: true,
  startDate: true,
  endDate: true,
  allDay: true,
  imageUrl: true,
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
  imageUrl: string | null;
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

// Real in-app votes weighted far above the source's external count (see
// curationInterest), so the digest's "highest-interest" fallback and ordering
// aren't dominated by high-RA electronic shows the way the raw blended count was.
const interestOf = (e: DigestEvent) =>
  curationInterest(e._count.interests, e.externalInterest);

// 0=Sun … 6=Sat in SF local time.
function sfWeekday(date: Date): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: SF_TZ, weekday: "short" }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(short);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * The Monday→Sunday window for "this week" in SF, as UTC instants.
 *
 * The cron fires Monday morning SF time, so this anchors to the Monday of the
 * current SF week and runs through the following Sunday — the full week ahead.
 * Sunday is treated as the tail of the week that just began (daysToMonday = -6),
 * so a stray weekend run still resolves to a sensible 7-day span. Calendar
 * arithmetic runs on UTC date parts — same trick as sfDate.isTomorrowSF — then
 * sfDayStart/End recompute the SF offset per date, so the window is correct
 * across DST.
 */
export function weekWindow(now: Date): { start: Date; end: Date; label: string } {
  const wd = sfWeekday(now);
  const daysToMonday = wd === 0 ? -6 : 1 - wd; // Sunday belongs to the week that just started

  const [y, m, d] = sfDayKey(now).split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const keyAt = (offsetDays: number) => {
    const x = new Date(base);
    x.setUTCDate(base.getUTCDate() + offsetDays);
    return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
  };

  const start = sfDayStart(keyAt(daysToMonday));
  const end = sfDayEnd(keyAt(daysToMonday + 6));
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
 * The week's editorial picks: the auto-feature set, newest-first by start.
 * Falls back to the highest-interest events of the week when nothing is featured,
 * so the digest is never empty as long as there are events.
 */
export function featuredPicks(week: DigestEvent[], limit = 6): DigestEvent[] {
  const featured = week
    .filter((e) => e.featured)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  if (featured.length) return featured.slice(0, limit);
  return [...week].sort((a, b) => interestOf(b) - interestOf(a)).slice(0, limit);
}

/**
 * Week events matching the reader's hearted categories/neighbourhoods,
 * excluding anything already shown in `exclude` (the featured picks). Ranked by
 * interest, then soonest. Empty when the reader has no history or no matches.
 */
export function personalizedPicks(
  week: DigestEvent[],
  prefs: ReaderPrefs,
  exclude: DigestEvent[],
  limit = 6
): DigestEvent[] {
  if (!prefs.categories.size && !prefs.neighborhoods.size) return [];
  const excluded = new Set(exclude.map((e) => e.id));
  return week
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

/** "Fri, Jun 12 · 5:00 PM" — weekday helps readers slot the event into a plan. */
function whenLabel(e: DigestEvent): string {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: SF_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(e.startDate);
  return e.allDay ? day : `${day} · ${formatTimeSF(e.startDate)}`;
}

/** Inline category pill + neighbourhood + price, all optional. */
function metaLine(e: DigestEvent): string {
  const label = e.category ? CATEGORY_LABELS[e.category] ?? null : null;
  const pill = label
    ? `<span style="display:inline-block;background:#f1f1f1;color:#444;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px">${esc(label)}</span>`
    : "";
  const rest = [e.neighborhood, e.isFree ? "Free" : e.price].filter(Boolean).join(" · ");
  if (!pill && !rest) return "";
  const restSpan = rest
    ? `<span style="font-size:12px;color:#999">${pill ? "&nbsp;&nbsp;" : ""}${esc(rest)}</span>`
    : "";
  return `<div style="margin-top:6px">${pill}${restSpan}</div>`;
}

const thumb = (url: string, size: number) =>
  `<img src="${esc(url)}" width="${size}" height="${size}" alt="" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:8px;display:block;background:#f2f2f2">`;

/** Big lead card for the single top pick — full-width image, then title + meta. */
function heroRow(e: DigestEvent, baseUrl: string): string {
  const venue = e.venueName ? ` · ${esc(e.venueName)}` : "";
  const image = e.imageUrl
    ? `<img src="${esc(e.imageUrl)}" width="520" alt="" style="width:100%;max-width:520px;height:auto;border-radius:12px;display:block;background:#f2f2f2;margin:0 0 12px">`
    : "";
  return `
    <a href="${baseUrl}/events/${e.id}" style="display:block;text-decoration:none;color:inherit;margin:16px 0 8px">
      ${image}
      <div style="font-size:21px;font-weight:800;color:#000;line-height:1.25;margin:0 0 4px">${esc(e.title)}</div>
      <div style="font-size:14px;color:#666">${esc(whenLabel(e))}${venue}</div>
      ${metaLine(e)}
    </a>`;
}

function eventRow(e: DigestEvent, baseUrl: string): string {
  const venue = e.venueName ? ` · ${esc(e.venueName)}` : "";
  const text = `
    <div style="font-size:16px;font-weight:700;color:#000;line-height:1.3;margin:0 0 3px">${esc(e.title)}</div>
    <div style="font-size:13px;color:#666">${esc(whenLabel(e))}${venue}</div>
    ${metaLine(e)}`;
  const body = e.imageUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td width="86" valign="top" style="padding-right:14px">${thumb(e.imageUrl, 72)}</td>
        <td valign="top">${text}</td>
      </tr></table>`
    : text;
  return `
    <a href="${baseUrl}/events/${e.id}" style="display:block;text-decoration:none;color:inherit;padding:16px 0;border-bottom:1px solid #eee">
      ${body}
    </a>`;
}

function section(title: string, events: DigestEvent[], baseUrl: string): string {
  if (!events.length) return "";
  return `
    <h3 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#888;margin:36px 0 4px">${esc(title)}</h3>
    ${events.map((e) => eventRow(e, baseUrl)).join("")}`;
}

export interface RenderArgs {
  weekLabel: string;
  weekCount: number;
  picks: DigestEvent[];
  personalized: DigestEvent[];
  curatorNote: string | null;
  baseUrl: string;
  unsubscribeToken: string;
}

export function digestSubject(args: Pick<RenderArgs, "picks" | "weekLabel">): string {
  const top = args.picks[0];
  if (!top) return `This week in SF · ${args.weekLabel}`;
  const rest = args.picks.length - 1;
  return rest > 0
    ? `This week in SF: ${top.title} + ${rest} more`
    : `This week in SF: ${top.title}`;
}

export function renderDigestEmail(args: RenderArgs): string {
  const { weekLabel, weekCount, picks, personalized, curatorNote, baseUrl, unsubscribeToken } = args;
  const unsubscribeUrl = `${baseUrl}/api/unsubscribe?token=${unsubscribeToken}`;
  const [lead, ...rest] = picks;
  const countLine =
    weekCount > 0
      ? `${weekCount} event${weekCount === 1 ? "" : "s"} this week · ${esc(weekLabel)}`
      : `This week in SF · ${esc(weekLabel)}`;
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
      <h2 style="font-size:24px;font-weight:900;margin:0 0 4px">happening</h2>
      <p style="color:#888;font-size:13px;margin:0 0 20px">${countLine}</p>
      ${curatorNote ? `<p style="font-size:15px;line-height:1.55;color:#333;margin:0 0 4px">${esc(curatorNote)}</p>` : ""}
      ${lead ? heroRow(lead, baseUrl) : ""}
      ${section(rest.length ? "More featured this week" : "Featured this week", rest, baseUrl)}
      ${section("Picked for you", personalized, baseUrl)}
      <p style="font-size:14px;margin:36px 0 0;text-align:center">
        <a href="${baseUrl}" style="display:inline-block;background:#000;color:#fff;font-weight:700;text-decoration:none;padding:12px 24px;border-radius:8px">See everything on happening →</a>
      </p>
      <p style="font-size:11px;color:#aaa;margin:32px 0 0;line-height:1.5">
        You're getting this because you have a happening account.
        <a href="${unsubscribeUrl}" style="color:#aaa">Unsubscribe</a> from the weekly digest.
      </p>
    </div>`;
}
