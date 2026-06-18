import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import axios from "axios";
import { prisma } from "../lib/prisma";
import { sfDateFromLocal, formatDateTimeSF, sfHourOf } from "../lib/sfDate";

/**
 * One-off backfill for #196: OpenMicX dated shows were stored 7-8h early.
 *
 * The feed's `date_time` (e.g. "2026-06-18T19:45:00.000Z") carries SF wall-clock
 * fields mislabeled with a `Z`, so `new Date()` read 7:45 PM as 12:45 PM. The
 * scraper now reinterprets those literal fields as SF local; this corrects the
 * rows already in the DB.
 *
 * Two sources of truth, in priority order:
 *   1. The live API — re-fetched and matched by externalId (`openmicx-show-<id>`).
 *      Exact and fully idempotent: re-running sets the same corrected instant.
 *   2. Derivation — for rows no longer in the feed (past / same-day shows). The
 *      stored buggy instant's *UTC* fields equal the original literal fields, so
 *      sfDateFromLocal(utcFields) recovers the intended SF time. Guarded to rows
 *      whose current SF hour is in the shifted-evening band (9am–4pm) so a second
 *      run — where corrected rows now read as evening — leaves them untouched.
 *
 * Dry run by default; pass `--apply` to write.
 */

const API = "https://openmicx.com/api/shows/upcoming?city=san-francisco&limit=200";
const APPLY = process.argv.includes("--apply");

/** Read literal Y/M/D/H/M from an ISO-ish string, reinterpreted as SF local. */
function localFieldsAsSF(value: unknown): Date | null {
  const m = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, min] = m.map(Number);
  return sfDateFromLocal(y, mo, d, h, min);
}

/** Recover the intended SF time from a buggy stored instant via its UTC fields. */
function deriveFromStored(stored: Date): Date {
  return sfDateFromLocal(
    stored.getUTCFullYear(),
    stored.getUTCMonth() + 1,
    stored.getUTCDate(),
    stored.getUTCHours(),
    stored.getUTCMinutes()
  );
}

async function main() {
  // 1. Build externalId → corrected-start map from the live feed.
  const apiTarget = new Map<string, Date>();
  try {
    const { data } = await axios.get<{ events?: any[] }>(API, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      timeout: 20_000,
    });
    for (const e of data?.events ?? []) {
      if (e.id == null) continue;
      const corrected = localFieldsAsSF(e.date_time);
      if (corrected) apiTarget.set(`openmicx-show-${e.id}`, corrected);
    }
    console.log(`Feed: ${apiTarget.size} upcoming shows with corrected times.`);
  } catch (err: any) {
    console.warn(`Feed fetch failed (${err.message}); using derivation only.`);
  }

  // Only rows that can still be displayed matter; archived past rows are skipped.
  const cutoff = new Date(Date.now() - 2 * 86_400_000);
  const rows = await prisma.event.findMany({
    where: {
      externalId: { startsWith: "openmicx-show-" },
      startDate: { gte: cutoff },
    },
    select: { id: true, title: true, startDate: true, externalId: true },
    orderBy: { startDate: "asc" },
  });
  console.log(`Scanning ${rows.length} openmicx-show rows from ${formatDateTimeSF(cutoff)} onward.\n`);

  let updated = 0;
  let skipped = 0;
  for (const r of rows) {
    let target = r.externalId ? apiTarget.get(r.externalId) : undefined;
    let via = "api";

    if (!target) {
      // Not in the feed: derive, but only for rows still in the shifted band so
      // already-corrected evening rows are left alone (idempotency).
      const hr = sfHourOf(r.startDate);
      if (hr < 9 || hr > 16) {
        skipped++;
        continue;
      }
      target = deriveFromStored(r.startDate);
      via = "derive";
    }

    if (target.getTime() === r.startDate.getTime()) {
      skipped++;
      continue;
    }

    console.log(
      `  ${via.padEnd(6)} ${formatDateTimeSF(r.startDate)} → ${formatDateTimeSF(target)}  | ${r.title.slice(0, 50)}`
    );
    if (APPLY) {
      await prisma.event.update({ where: { id: r.id }, data: { startDate: target } });
    }
    updated++;
  }

  console.log(
    `\n${APPLY ? "Applied" : "DRY RUN"} — ${updated} to correct, ${skipped} unchanged, ${rows.length} total.`
  );
  if (!APPLY && updated > 0) console.log("Re-run with --apply to write.");
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
