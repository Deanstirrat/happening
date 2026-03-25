import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

chromium.use(StealthPlugin());

const BASE = "http://www.foopee.com/punk/the-list/";

/**
 * Foopee Punk List — http://www.foopee.com/punk/the-list/
 *
 * The index page links to weekly pages (by-date.N.html). Each weekly page
 * has date-group <li> elements containing nested <ul><li> event items:
 *
 *   <li><a name="mar_23"><b>Mon Mar 23</b></a><ul>
 *     <li><b><a href="...">Venue</a></b> <a href="...">Band</a>, ... info</li>
 *   </ul></li>
 */
export class FoopeeScraper extends BaseScraper {
  readonly sourceSlug = "foopee";

  async scrape(): Promise<ScrapedEvent[]> {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    const page = await browser.newPage();

    // Collect weekly page URLs from the index
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
    const indexHtml = await page.content();
    const $index = cheerio.load(indexHtml);
    const byDateUrls: string[] = [];
    $index('a[href^="by-date."]').each((_i, el) => {
      const href = $index(el).attr("href")!;
      byDateUrls.push(`${BASE}${href}`);
    });

    const events: ScrapedEvent[] = [];

    for (const url of byDateUrls) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      const html = await page.content();
      events.push(...this.parsePage(html, url));
    }

    await browser.close();
    return events;
  }

  private parsePage(html: string, pageUrl: string): ScrapedEvent[] {
    const $ = cheerio.load(html);
    const events: ScrapedEvent[] = [];

    const monthMap: Record<string, number> = {
      Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
      Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
    };

    // Date-group <li> elements have a direct child <a name="..."><b>Day Mon DD</b></a>
    $("li").each((_i, dateGroup) => {
      const dateBold = $(dateGroup).children("a[name]").find("b").text().trim();
      const dateMatch = dateBold.match(
        /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})$/
      );
      if (!dateMatch) return;

      const month = monthMap[dateMatch[2]];
      const day = parseInt(dateMatch[3]);
      const year = this.resolveYear(month, day);
      const currentDate = new Date(year, month - 1, day, 19, 0, 0);

      // Event items are in the directly nested <ul>
      $(dateGroup).find("> ul > li").each((_j, eventLi) => {
        const venueName = $(eventLi).find("b > a").first().text().trim();

        // Band links are <a> elements NOT inside a <b>
        const bandLinks = $(eventLi).find("a").filter((_k, a) => {
          return $(a).parent("b").length === 0;
        });
        const bands = bandLinks
          .map((_k, a) => $(a).text().trim())
          .get()
          .filter(Boolean);

        const title = bands.join(", ");
        if (!title) return;

        // Info text (age/price/time): clone and strip all links
        const clone = $(eventLi).clone();
        clone.find("a").remove();
        const infoText = clone.text().replace(/\s+/g, " ").trim();

        const priceMatch = infoText.match(/\$[\d.]+(?:\/\$[\d.]+)?/);
        const price = priceMatch ? priceMatch[0] : undefined;
        const isFree = /\bfree\b/i.test(infoText);

        // Source URL: first band link href
        const href = bandLinks.first().attr("href");
        const sourceUrl = href ? `${BASE}${href}` : pageUrl;

        events.push({
          title,
          startDate: new Date(currentDate),
          venueName: venueName || undefined,
          price,
          isFree,
          sourceUrl,
          tags: ["punk", "rock", "diy"],
        });
      });
    });

    return events;
  }
}
