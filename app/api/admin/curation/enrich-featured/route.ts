import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/auth";
import { enrichEvent, type EnrichResult } from "@/lib/enrichFeatured";

const CONCURRENCY = 3;

// Per-event enrichment (title cleanup, image cascade, description) lives in
// lib/enrichFeatured.ts — shared with the nightly Railway cron
// (scripts/enrich-featured.ts) so the admin button and the cron behave
// identically. This route only adds auth, per-event/query timeouts, and the
// JSON response the admin UI renders.

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

// ─── Main handler ─────────────────────────────────────────────────────────────

async function runEnrichFeatured() {
  console.log("[enrich-featured] Starting — querying featured events...");
  const now = new Date();
  const events = await Promise.race([
    prisma.event.findMany({
      where: { featured: true, startDate: { gte: now }, status: "PUBLISHED" },
      select: {
        id: true,
        title: true,
        description: true,
        sourceUrl: true,
        imageUrl: true,
        venueName: true,
        city: true,
        startDate: true,
        category: true,
        featuredBlurb: true,
        source: { select: { slug: true } },
      },
      orderBy: { featuredAt: "desc" },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("DB query timed out after 15s")), 15_000)
    ),
  ]);
  console.log(`[enrich-featured] Query complete — ${events.length} event(s) found.`);

  if (events.length === 0) {
    console.log("[enrich-featured] No upcoming featured events found.");
    return {
      ok: true,
      processed: 0,
      imagesFixed: 0,
      imagesFromSearch: 0,
      usedFallback: 0,
      usedFallbackDetails: [],
      descriptionsAdded: 0,
      titlesRenamed: 0,
      titlesRenamedDetails: [],
      brokenSources: 0,
      titleMismatches: [],
    };
  }

  console.log(`\n[enrich-featured] === Enriching ${events.length} featured event(s) ===\n`);

  const results: EnrichResult[] = [];
  let i = 0;

  for (let batch = 0; batch < events.length; batch += CONCURRENCY) {
    const chunk = events.slice(batch, batch + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (event) => {
        i++;
        console.log(`[enrich-featured] [${i}/${events.length}] ${event.title}`);
        const EVENT_TIMEOUT_MS = 60_000;
        const { source, ...row } = event;
        const r = await Promise.race([
          enrichEvent({ ...row, sourceSlug: source.slug }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("event timeout")), EVENT_TIMEOUT_MS)
          ),
        ]).catch((err: Error) => {
          console.log(`[enrich-featured]   ⚠ skipped (${err.message})`);
          return {
            id: event.id,
            title: event.title,
            sourceOk: false,
            sourceStatus: 0,
            imageFixed: false,
            imageSource: null,
            usedFallbackImage: false,
            descriptionEnriched: false,
            descriptionSource: null,
            blurbAdded: false,
            titleRenamed: null,
            titleMismatch: null,
          } satisfies EnrichResult;
        });

        const sourceLabel = r.sourceOk ? `${r.sourceStatus} OK` : `${r.sourceStatus || "ERR"} ⚠`;
        console.log(`[enrich-featured]   source:      ${event.sourceUrl.slice(0, 70)} → ${sourceLabel}`);

        if (r.imageFixed) {
          const via = r.imageSource === "websearch" ? "web search" : "og:image";
          console.log(`[enrich-featured]   image:       found via ${via} ✓`);
        } else if (r.usedFallbackImage) {
          console.log(`[enrich-featured]   image:       no real image found → using fallback placeholder ⚑`);
        } else if (event.imageUrl) {
          console.log(`[enrich-featured]   image:       ${event.imageUrl.slice(0, 70)} → OK`);
        } else {
          console.log(`[enrich-featured]   image:       null`);
        }

        const descLen = (event.description ?? "").length;
        if (r.descriptionEnriched) {
          console.log(`[enrich-featured]   description: ${descLen} chars → enriched via ${r.descriptionSource} ✓`);
        } else {
          console.log(`[enrich-featured]   description: ${descLen} chars`);
        }

        if (r.titleRenamed) {
          console.log(`[enrich-featured]   title:       "${event.title.slice(0, 55)}" → "${r.titleRenamed.slice(0, 55)}" ✓`);
        } else if (r.titleMismatch) {
          console.log(`[enrich-featured]   title check: ⚠ page says "${r.titleMismatch.slice(0, 60)}"`);
        }

        return r;
      })
    );
    results.push(...chunkResults);
  }

  const brokenSources = results.filter((r) => !r.sourceOk).map((r) => ({ id: r.id, title: r.title, status: r.sourceStatus }));
  const titleMismatches = results
    .filter((r) => r.titleMismatch)
    .map((r) => ({ id: r.id, stored: r.title, page: r.titleMismatch! }));
  const titlesRenamedDetails = results
    .filter((r) => r.titleRenamed)
    .map((r) => ({ id: r.id, from: r.title, to: r.titleRenamed! }));

  const imagesFromSearch = results.filter((r) => r.imageSource === "websearch").length;
  const usedFallback = results.filter((r) => r.usedFallbackImage).map((r) => ({ id: r.id, title: r.title }));

  console.log(`\n[enrich-featured] === Summary ===`);
  console.log(`[enrich-featured]   Processed:           ${results.length}`);
  console.log(`[enrich-featured]   Images fixed:        ${results.filter((r) => r.imageFixed).length} (${imagesFromSearch} via web search)`);
  console.log(`[enrich-featured]   Fallback images:     ${usedFallback.length} (no real image — kept featured)`);
  console.log(`[enrich-featured]   Descriptions added:  ${results.filter((r) => r.descriptionEnriched).length}`);
  console.log(`[enrich-featured]   Blurbs added:        ${results.filter((r) => r.blurbAdded).length}`);
  console.log(`[enrich-featured]   Titles renamed:      ${titlesRenamedDetails.length}`);
  console.log(`[enrich-featured]   Broken sources:      ${brokenSources.length}`);
  console.log(`[enrich-featured]   Title mismatches:    ${titleMismatches.length}`);

  return {
    ok: true,
    processed: results.length,
    imagesFixed: results.filter((r) => r.imageFixed).length,
    imagesFromSearch,
    usedFallback: usedFallback.length,
    usedFallbackDetails: usedFallback,
    descriptionsAdded: results.filter((r) => r.descriptionEnriched).length,
    blurbsAdded: results.filter((r) => r.blurbAdded).length,
    titlesRenamed: titlesRenamedDetails.length,
    titlesRenamedDetails,
    brokenSources: brokenSources.length,
    brokenSourceDetails: brokenSources,
    titleMismatches,
  };
}

export async function GET(req: NextRequest) {
  if (!(await checkCronOrAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runEnrichFeatured();
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
    const result = await runEnrichFeatured();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
