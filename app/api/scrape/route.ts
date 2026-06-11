import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/adminAuth";

export async function POST(req: NextRequest) {
  // Machine caller (scrape trigger) — authenticates with the header secret.
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runScraper, SCRAPERS } = await import("@/lib/scrapers/runner");

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
