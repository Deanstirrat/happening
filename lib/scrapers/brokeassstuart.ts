import { DothebayScraper } from "./dothebay";

/**
 * Broke Ass Stuart DoTheBay — brokeassstuart.dothebay.com
 *
 * Curated SF/Bay Area calendar powered by the DoTheBay platform. The HTML
 * structure (Schema.org microdata on [itemprop="event"] cards) and the listing
 * behaviour are identical to dothebay.com, so we reuse DothebayScraper's
 * date-path walk and parsing — only the host, slug, brand tag, and day-window
 * env var differ. The subdomain returns 403 for simple bots, but the shared
 * scraper already sends a full browser User-Agent + Accept-Language.
 */
export class BrokeAssStuartScraper extends DothebayScraper {
  readonly sourceSlug = "brokeassstuart";
  protected readonly BASE_URL = "https://brokeassstuart.dothebay.com";
  protected readonly extraTags = ["broke-ass-stuart"];
  protected readonly daysAhead = parseInt(process.env.MAX_DAYS_BROKEASSSTUART ?? "30");
}
