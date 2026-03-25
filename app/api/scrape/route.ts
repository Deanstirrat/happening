import { NextRequest, NextResponse } from "next/server";
import { runScraper, SCRAPERS } from "@/lib/scrapers/runner";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-scrape-secret");
  if (secret !== process.env.SCRAPE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const source = body.source ?? "all";

  const slugs =
    source === "all"
      ? Object.keys(SCRAPERS)
      : [source];

  const results: Record<string, { scraped: number; inserted: number; error?: string }> = {};

  for (const slug of slugs) {
    try {
      const result = await runScraper(slug);
      results[slug] = result;
    } catch (err) {
      results[slug] = {
        scraped: 0,
        inserted: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return NextResponse.json({ results });
}
