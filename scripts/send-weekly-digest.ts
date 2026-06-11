import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { randomBytes } from "crypto";
import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import {
  DIGEST_EVENT_SELECT,
  weekendWindow,
  readerPrefs,
  featuredPicks,
  personalizedPicks,
  renderDigestEmail,
  digestSubject,
  type DigestEvent,
} from "@/lib/digest";

/**
 * Weekly "this weekend in SF" email digest (issue #97).
 *
 * Sends every opted-in account a personalized weekend roundup: the auto-feature
 * editorial picks plus events matching the categories/neighbourhoods they've
 * hearted (issue #96 attributes hearts to accounts). The strongest return-visit
 * mechanic we have — Resend is already wired up for magic links.
 *
 * Intended to run on a Railway cron (see railway.email-digest.toml), same
 * pattern as the scrape / archive-past / merge-dups jobs. Best fired Thursday or
 * Friday morning SF time so the weekend window is the coming Fri–Sun.
 *
 * Usage:
 *   npm run send-digest             # send
 *   npm run send-digest -- --dry    # render + log, never send or write
 *
 * Env:
 *   RESEND_API_KEY        required to send (omitted in --dry).
 *   RESEND_FROM_EMAIL     verified sender (default onboarding@resend.dev).
 *   NEXT_PUBLIC_BASE_URL  base for event + unsubscribe links.
 *   DATABASE_URL          required.
 */

// Always ship a friendly display name so inboxes show "happening", not the bare
// "noreply" local part. Honour a name the env already provides (e.g. "X <a@b>").
const FROM_ADDRESS = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";
const FROM = FROM_ADDRESS.includes("<") ? FROM_ADDRESS : `happening <${FROM_ADDRESS}>`;
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? "https://happeningsf.now").replace(/\/$/, "");

// Mint the unsubscribe capability token the first time we email an account.
function unsubscribeToken(): string {
  return randomBytes(32).toString("base64url");
}

async function main() {
  const dryRun = process.argv.includes("--dry");

  const { start, end, label } = weekendWindow(new Date());
  console.log(`${dryRun ? "[DRY RUN] " : ""}Weekend digest for ${label} (${start.toISOString()} → ${end.toISOString()})`);

  // One query for the whole weekend; sliced per reader in memory.
  const weekend = (await prisma.event.findMany({
    where: {
      status: "PUBLISHED",
      startDate: { gte: start, lte: end },
    },
    select: DIGEST_EVENT_SELECT,
  })) as DigestEvent[];

  if (!weekend.length) {
    console.log("No published events this weekend — nothing to send.");
    return;
  }
  const picks = featuredPicks(weekend);
  console.log(`${weekend.length} weekend events, ${picks.length} featured picks.`);

  // Latest editorial note seeds the intro blurb when present.
  const latestInsight = await prisma.curationInsight.findFirst({ orderBy: { weekOf: "desc" } });
  const curatorNote = latestInsight?.insight ?? null;

  const recipients = await prisma.user.findMany({
    where: { digestOptIn: true },
    select: {
      id: true,
      email: true,
      unsubscribeToken: true,
      interests: { select: { event: { select: { category: true, neighborhood: true } } } },
    },
  });
  console.log(`${recipients.length} opted-in recipient(s).`);

  const resend = dryRun ? null : new Resend(process.env.RESEND_API_KEY);
  let sent = 0;
  let skipped = 0;

  for (const user of recipients) {
    const prefs = readerPrefs(user.interests);
    const personalized = personalizedPicks(weekend, prefs, picks);

    // Featured picks are global, so a digest is empty only when there were no
    // weekend events at all — already handled above. Guard anyway.
    if (!picks.length && !personalized.length) {
      skipped++;
      continue;
    }

    const token = user.unsubscribeToken ?? unsubscribeToken();
    const html = renderDigestEmail({
      weekendLabel: label,
      weekendCount: weekend.length,
      picks,
      personalized,
      curatorNote,
      baseUrl: BASE_URL,
      unsubscribeToken: token,
    });
    const subject = digestSubject({ picks, weekendLabel: label });

    if (dryRun) {
      console.log(`  [dry] ${user.email} — "${subject}" (${personalized.length} personalized)`);
      sent++;
      continue;
    }

    try {
      // RFC 8058 one-click unsubscribe. Gmail/Yahoo bulk-sender rules (Feb 2024)
      // expect this header; its absence both hurts deliverability and nudges mail
      // toward the Promotions/Spam tabs. The POST target lives in the unsubscribe route.
      const unsubscribeUrl = `${BASE_URL}/api/unsubscribe?token=${token}`;
      await resend!.emails.send({
        from: FROM,
        to: user.email,
        subject,
        html,
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      // Persist the freshly minted token + send timestamp in one write.
      await prisma.user.update({
        where: { id: user.id },
        data: { unsubscribeToken: token, lastDigestSentAt: new Date() },
      });
      sent++;
    } catch (err) {
      // One bad address shouldn't abort the run.
      console.error(`  ✗ ${user.email}:`, err instanceof Error ? err.message : err);
      skipped++;
    }
  }

  console.log(`Done. ${dryRun ? "would send" : "sent"} ${sent}, skipped ${skipped}.${dryRun ? " (dry run — no writes)" : ""}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
