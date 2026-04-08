/**
 * Backfill images for Instagram events that are missing one.
 *
 * Finds Instagram events with no imageUrl (or a dead cdninstagram.com URL),
 * re-fetches the post data from Apify using directUrls, downloads the image,
 * uploads it to Vercel Blob, and updates the DB row.
 *
 * Run with:
 *   npx tsx scripts/backfill-instagram-images.ts
 *
 * Requires: APIFY_API_KEY and BLOB_READ_WRITE_TOKEN in .env.local
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env", override: true });
dotenv.config({ path: ".env.local", override: true });

import { put } from "@vercel/blob";
import { prisma } from "../lib/prisma";

const APIFY_BATCH = 20; // Apify handles up to ~50 directUrls per run comfortably
const CONCURRENCY = 5;

interface ApifyPost {
  shortCode: string;
  displayUrl: string | null;
  timestamp: string;
}

async function refetchPosts(postUrls: string[]): Promise<ApifyPost[]> {
  const url =
    `https://api.apify.com/v2/acts/apify~instagram-post-scraper` +
    `/run-sync-get-dataset-items?token=${process.env.APIFY_API_KEY}&timeout=300`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: postUrls,
      dataDetailLevel: "basicData",
    }),
    signal: AbortSignal.timeout(330_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Apify ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) throw new Error("Unexpected Apify response shape");
  return data as ApifyPost[];
}

async function uploadToBlob(imageUrl: string, shortCode: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; happening-sf/1.0)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.includes("webp")
      ? "webp"
      : contentType.includes("png")
      ? "png"
      : "jpg";
    const blob = await put(`event-images/instagram-${shortCode}.${ext}`, res.body!, {
      access: "public",
      contentType,
    });
    return blob.url;
  } catch (err) {
    console.warn(`  ✗ Blob upload failed for ${shortCode}:`, (err as Error).message);
    return null;
  }
}

async function main() {
  if (!process.env.APIFY_API_KEY) {
    console.error("APIFY_API_KEY not set — aborting");
    process.exit(1);
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("BLOB_READ_WRITE_TOKEN not set — aborting");
    process.exit(1);
  }

  // Find Instagram events with no image or a stale CDN URL
  const events = await prisma.event.findMany({
    where: {
      source: { slug: "instagram" },
      externalId: { not: null },
      OR: [
        { imageUrl: null },
        { imageUrl: { contains: "cdninstagram.com" } },
      ],
    },
    select: { id: true, title: true, externalId: true, imageUrl: true },
  });

  console.log(`Found ${events.length} Instagram events missing a permanent image`);
  if (events.length === 0) {
    await prisma.$disconnect();
    return;
  }

  let updated = 0;
  let failed = 0;

  // Process in Apify batches
  for (let i = 0; i < events.length; i += APIFY_BATCH) {
    const batch = events.slice(i, i + APIFY_BATCH);
    const postUrls = batch.map(
      (e) => `https://www.instagram.com/p/${e.externalId}/`
    );

    console.log(`\nBatch ${Math.floor(i / APIFY_BATCH) + 1}: re-fetching ${batch.length} posts from Apify…`);

    let posts: ApifyPost[];
    try {
      posts = await refetchPosts(postUrls);
    } catch (err) {
      console.error("  Apify batch failed:", (err as Error).message);
      failed += batch.length;
      continue;
    }

    // Build shortCode → displayUrl map
    const displayMap = new Map<string, string>();
    for (const post of posts) {
      if (post.shortCode && post.displayUrl) {
        displayMap.set(post.shortCode, post.displayUrl);
      }
    }

    console.log(`  Got ${displayMap.size} posts with images from Apify`);

    // Upload images in parallel with limited concurrency
    for (let j = 0; j < batch.length; j += CONCURRENCY) {
      const chunk = batch.slice(j, j + CONCURRENCY);
      await Promise.all(
        chunk.map(async (event) => {
          const displayUrl = displayMap.get(event.externalId!);
          if (!displayUrl) {
            console.log(`  - ${event.title}: no image returned by Apify`);
            failed++;
            return;
          }

          const blobUrl = await uploadToBlob(displayUrl, event.externalId!);
          if (!blobUrl) {
            failed++;
            return;
          }

          await prisma.event.update({
            where: { id: event.id },
            data: { imageUrl: blobUrl },
          });
          console.log(`  ✓ ${event.title}`);
          updated++;
        })
      );
    }
  }

  console.log(`\nDone — ${updated} updated, ${failed} failed/unavailable`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
