import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/auth";
import { CATEGORY_LABELS } from "@/lib/types";
import { subDays } from "date-fns";
import { anthropic } from "@/lib/anthropic";

// Machine callers (Vercel cron) authenticate with the CRON_SECRET bearer token;
// human admins authenticate with their session cookie + ADMIN role.
async function checkCronOrAdminAuth(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth === `Bearer ${cronSecret}`) return true;
  }
  return (await getAdminUser(req)) !== null;
}

// Returns the most recent Monday at midnight UTC — used as the stable key for
// "this week's insight" so re-running within the same week upserts rather than
// creating a new record.
function currentWeekOf(): Date {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun … 6=Sat
  const daysToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - daysToMonday);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

async function runReflection() {
  // Analyse featured events that have already happened (past 14 days)
  const now = new Date();
  const windowEnd = now;
  const windowStart = subDays(now, 14);

  const featuredEvents = await prisma.event.findMany({
    where: {
      featured: true,
      startDate: { gte: windowStart, lt: windowEnd },
    },
    select: {
      id: true,
      title: true,
      category: true,
      tags: true,
      neighborhood: true,
      isFree: true,
      interactions: {
        select: { type: true },
      },
    },
  });

  if (featuredEvents.length < 3) {
    return {
      ok: true,
      message: "Not enough data for reflection (need at least 3 events)",
      skipped: true,
    };
  }

  // Compute per-event metrics
  const eventsWithMetrics = featuredEvents.map((e) => {
    const views = e.interactions.filter((i) => i.type === "VIEW").length;
    const clicks = e.interactions.filter((i) => i.type === "CLICK").length;
    const ctr = views > 0 ? clicks / views : 0;
    return {
      id: e.id,
      title: e.title,
      category: e.category ? CATEGORY_LABELS[e.category] : null,
      tags: e.tags,
      neighborhood: e.neighborhood,
      isFree: e.isFree,
      views,
      clicks,
      ctr,
    };
  });

  // Sort: highest CTR first, then clicks as tiebreaker
  const sorted = [...eventsWithMetrics].sort((a, b) => {
    if (b.ctr !== a.ctr) return b.ctr - a.ctr;
    return b.clicks - a.clicks;
  });

  const withData = sorted.filter((e) => e.views > 0);
  const noData = sorted.filter((e) => e.views === 0);

  const topCount = Math.min(8, Math.ceil(withData.length * 0.4));
  const bottomCount = Math.min(5, Math.floor(withData.length * 0.25));
  const topPerformers = withData.slice(0, topCount);
  const topIds = new Set(topPerformers.map((e) => e.id));
  const bottomPerformers = withData
    .slice(-bottomCount)
    .filter((e) => !topIds.has(e.id));

  const fmt = (e: (typeof eventsWithMetrics)[0]) =>
    [
      `- "${e.title}"`,
      e.category ? `[${e.category}]` : null,
      e.tags.length ? `tags: ${e.tags.slice(0, 4).join(", ")}` : null,
      `views: ${e.views}, clicks: ${e.clicks}, CTR: ${(e.ctr * 100).toFixed(0)}%`,
    ]
      .filter(Boolean)
      .join(" | ");

  const sections = [
    topPerformers.length
      ? `TOP PERFORMERS (highest CTR / clicks):\n${topPerformers.map(fmt).join("\n")}`
      : null,
    bottomPerformers.length
      ? `LOW PERFORMERS:\n${bottomPerformers.map(fmt).join("\n")}`
      : null,
    noData.length
      ? `NO IMPRESSIONS:\n${noData.map((e) => `- "${e.title}"`).join("\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    messages: [
      {
        role: "user",
        content: `You are the curator for "happening", an SF events discovery platform. We feature ~20 events per week and track views and clicks on each.

Analyse this week's performance data and produce a concise curation update that will be injected into future auto-feature prompts to improve picks.

${sections}

Write a curation update of max 150 words. Cover:
1. Which event types / qualities drove the most engagement
2. What fell flat and should be deprioritized
3. Any specific patterns in categories, tags, or format worth noting

Be direct and specific — no fluff. These notes will live inside a curation prompt alongside existing taste guidelines.

Start with "## Learnings from recent performance:" and use bullet points.`,
      },
    ],
  });

  const insight =
    response.content[0].type === "text" ? response.content[0].text : "";

  const weekOf = currentWeekOf();

  await prisma.curationInsight.upsert({
    where: { weekOf },
    update: { insight, topEvents: topPerformers },
    create: { weekOf, insight, topEvents: topPerformers },
  });

  return {
    ok: true,
    weekOf: weekOf.toISOString(),
    eventsAnalyzed: featuredEvents.length,
    insight,
  };
}

export async function GET(req: NextRequest) {
  if (!(await checkCronOrAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runReflection();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await checkCronOrAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runReflection();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
