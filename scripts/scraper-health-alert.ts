#!/usr/bin/env tsx
/**
 * Scraper health alert.
 *
 * Computes per-source health (see lib/scrapers/health.ts), prints a report, and
 * — when sources have gone dark or stale — emails an alert via Resend. Intended
 * to run on a Railway cron right after the daily scrape + auto-feature jobs so a
 * scraper that quietly returns 0 events gets surfaced instead of rotting.
 *
 * Usage:
 *   npm run health-alert            # report + send email if anything is wrong
 *   npm run health-alert -- --dry   # report only, never send
 *
 * Env:
 *   SCRAPER_ALERT_EMAIL   recipient(s), comma-separated. No email sent if unset.
 *   RESEND_API_KEY        required to send (already used for magic links).
 *   RESEND_FROM_EMAIL     sender, defaults to onboarding@resend.dev.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { Resend } from "resend";
import { prisma } from "../lib/prisma";
import {
  summarizeHealth,
  STALE_AFTER_DAYS,
  type SourceHealthInput,
  type SourceHealthResult,
} from "../lib/scrapers/health";

async function loadHealthInputs(now: Date): Promise<SourceHealthInput[]> {
  const [sources, upcomingBySource] = await Promise.all([
    prisma.source.findMany({ orderBy: { name: "asc" } }),
    prisma.event.groupBy({
      by: ["sourceId"],
      // Mirror the user-facing event queries: only PUBLISHED events count as
      // "upcoming". A source left with only ARCHIVED/REJECTED future rows shows
      // users 0 events and should read as dark.
      where: { startDate: { gte: now }, status: "PUBLISHED" },
      _count: { id: true },
    }),
  ]);

  const upcomingMap = new Map(upcomingBySource.map((r) => [r.sourceId, r._count.id]));

  return sources.map((s) => ({
    slug: s.slug,
    name: s.name,
    enabled: s.enabled,
    scrapeType: s.scrapeType,
    lastScrapedAt: s.lastScrapedAt,
    upcomingCount: upcomingMap.get(s.id) ?? 0,
  }));
}

function describe(s: SourceHealthResult): string {
  return `${s.name} (${s.slug}) — ${s.status}: ${s.reason}`;
}

function buildEmailHtml(attention: SourceHealthResult[], healthyCount: number): string {
  const rows = attention
    .map((s) => {
      const color = s.status === "stale" ? "#e85d5d" : "#e8a13b";
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600">${s.name}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#888">${s.slug}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;color:${color};font-weight:600;text-transform:uppercase">${s.status}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#888">${s.reason}</td>
        </tr>`;
    })
    .join("");

  return `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:32px 24px">
      <h2 style="font-size:22px;font-weight:900;margin:0 0 4px">happening — scraper health</h2>
      <p style="color:#888;font-size:13px;margin:0 0 24px">
        ${attention.length} source(s) need attention · ${healthyCount} healthy
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="text-align:left;color:#888;font-size:12px;text-transform:uppercase">
            <th style="padding:8px 12px">source</th>
            <th style="padding:8px 12px">slug</th>
            <th style="padding:8px 12px">status</th>
            <th style="padding:8px 12px">reason</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="font-size:12px;color:#888;margin:24px 0 0">
        Dark = scraper runs but returned 0 upcoming events. Stale = no run in
        &gt;${STALE_AFTER_DAYS} days. Check the admin scrapers page for detail.
      </p>
    </div>`;
}

async function main() {
  const dry = process.argv.includes("--dry");
  const now = new Date();

  const inputs = await loadHealthInputs(now);
  const health = summarizeHealth(inputs, now);

  console.log(`\n🩺 scraper health — ${now.toISOString()}\n`);
  console.log(
    `   healthy: ${health.healthy.length}   dark: ${health.dark.length}   ` +
      `stale: ${health.stale.length}   ignored: ${health.ignored.length}\n`
  );

  if (health.attention.length === 0) {
    console.log("✅ All monitored scrapers healthy. No alert.\n");
    return;
  }

  console.log("⚠️  Needs attention:");
  for (const s of health.attention) console.log(`   • ${describe(s)}`);
  console.log("");

  const recipients = (process.env.SCRAPER_ALERT_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  if (dry) {
    console.log("🔕 --dry: skipping email.\n");
    return;
  }
  if (recipients.length === 0) {
    console.log("🔕 SCRAPER_ALERT_EMAIL not set — skipping email.\n");
    return;
  }
  if (!process.env.RESEND_API_KEY) {
    console.log("🔕 RESEND_API_KEY not set — skipping email.\n");
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";

  // Resend resolves with { data, error } and does NOT throw on API-level
  // failures (unverified sender, invalid recipient, etc.). Since this cron is
  // the only notification path for dark/stale scrapers, treat a returned error
  // as a hard failure instead of falsely reporting success.
  const { data, error } = await resend.emails.send({
    from: fromEmail,
    to: recipients,
    subject: `⚠️ ${health.attention.length} scraper(s) need attention`,
    html: buildEmailHtml(health.attention, health.healthy.length),
  });

  if (error) {
    throw new Error(`Resend rejected the alert: ${error.name}: ${error.message}`);
  }

  console.log(`📧 Alert sent to ${recipients.join(", ")} (id: ${data?.id ?? "?"})\n`);
}

main()
  .catch((err) => {
    console.error("❌ health-alert failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
