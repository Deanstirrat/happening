/** Date utilities for San Francisco (America/Los_Angeles) timezone. */

const TZ = "America/Los_Angeles";

/** Returns the UTC timestamp for midnight (start of day) in SF timezone for a YYYY-MM-DD string */
export function sfDayStart(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  // Use noon UTC as a reference (safe from DST boundary issues)
  const ref = new Date(Date.UTC(y, m - 1, d, 12));
  const sfHourAtNoonUTC = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false }).format(ref)
  );
  const offsetHours = sfHourAtNoonUTC - 12; // e.g. -7 for PDT, -8 for PST
  return new Date(Date.UTC(y, m - 1, d, -offsetHours));
}

/** Returns the UTC timestamp for 23:59:59.999 (end of day) in SF timezone for a YYYY-MM-DD string */
export function sfDayEnd(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const ref = new Date(Date.UTC(y, m - 1, d, 12));
  const sfHourAtNoonUTC = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false }).format(ref)
  );
  const offsetHours = sfHourAtNoonUTC - 12;
  return new Date(Date.UTC(y, m - 1, d, 23 - offsetHours, 59, 59, 999));
}

/** Returns YYYY-MM-DD in SF timezone */
export function sfDayKey(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(date);
}

export function isTodaySF(date: Date): boolean {
  return sfDayKey(date) === sfDayKey(new Date());
}

export function isTomorrowSF(date: Date): boolean {
  const todayKey = sfDayKey(new Date());
  const [y, m, d] = todayKey.split("-").map(Number);
  const tom = new Date(y, m - 1, d + 1); // JS handles month/year overflow
  const tomorrowKey = [
    tom.getFullYear(),
    String(tom.getMonth() + 1).padStart(2, "0"),
    String(tom.getDate()).padStart(2, "0"),
  ].join("-");
  return sfDayKey(date) === tomorrowKey;
}

/** "6:00 PM" */
export function formatTimeSF(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/** "Wednesday, March 25, 2026" */
export function formatDateLongSF(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/** "wednesday, mar 25" (lowercased for DateGroup header) */
export function formatDateMediumSF(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "long",
    month: "short",
    day: "numeric",
  })
    .format(date)
    .toLowerCase();
}

/** "Mar 25" */
export function formatDateShortSF(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
  }).format(date);
}

/** "Mar 25 · 6:00 PM" */
export function formatDateTimeSF(date: Date): string {
  return `${formatDateShortSF(date)} · ${formatTimeSF(date)}`;
}

/** "20260325T180000" for Google Calendar links */
export function formatGCalSF(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  // hour12: false can return "24" for midnight; normalize to "00"
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}${get("month")}${get("day")}T${hour}${get("minute")}${get("second")}`;
}
