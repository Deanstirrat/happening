import { createHash } from "crypto";
import type { ScrapedEvent } from "@/lib/types";

export type { ScrapedEvent };

export abstract class BaseScraper {
  abstract readonly sourceSlug: string;
  abstract scrape(): Promise<ScrapedEvent[]>;

  /**
   * Compute a stable deduplication hash for an event.
   * Based on: source slug + ISO date (YYYY-MM-DD) + normalized title.
   */
  computeDedupeHash(event: ScrapedEvent): string {
    const dateStr = event.startDate.toISOString().slice(0, 10);
    const normalizedTitle = event.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const raw = `${dateStr}::${normalizedTitle}`;
    return createHash("sha256").update(raw).digest("hex");
  }

  /**
   * Guess if an event is free based on price string.
   */
  parseFree(price?: string): boolean {
    if (!price) return false;
    const lower = price.toLowerCase();
    return (
      lower === "free" ||
      lower.includes("free admission") ||
      lower.includes("no cover") ||
      lower === "$0" ||
      lower === "0"
    );
  }

  /**
   * Rolling-year heuristic: if the scraped date is more than 60 days in the
   * past, assume it refers to next year. Useful for sites that don't include
   * the year in their date strings.
   */
  resolveYear(month: number, day: number): number {
    const now = new Date();
    const currentYear = now.getFullYear();
    const candidate = new Date(currentYear, month - 1, day);
    const diffDays = (candidate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays < -60 ? currentYear + 1 : currentYear;
  }
}
