/**
 * Shared headless-browser HTML fetch for scrapers whose source blocks plain
 * HTTP clients (TLS-fingerprint / bot challenges that reset the connection or
 * return 403 to axios, even with a browser User-Agent). Mirrors the Playwright +
 * stealth approach already proven in citylights.ts, but factored out so the
 * several sources that only need "render this page and hand me the HTML" don't
 * each re-implement the browser dance.
 *
 * The caller's existing cheerio parsing is unchanged — these helpers just swap
 * the transport. One browser is launched per call and reused across the given
 * URLs, then always closed.
 */

interface FetchOptions {
  /** Wait for this selector before reading content (gives JS challenges time to resolve). */
  waitSelector?: string;
  /** Per-navigation timeout. Defaults to 30s. */
  timeoutMs?: number;
}

/**
 * Load each URL in a stealth headless browser and return its rendered HTML.
 * A URL that fails to load yields `html: null` (logged) rather than throwing,
 * so one dead page doesn't sink the whole run.
 */
export async function fetchRenderedPages(
  urls: string[],
  opts: FetchOptions = {}
): Promise<Array<{ url: string; html: string | null }>> {
  const { chromium } = await import("playwright-extra");
  const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
  chromium.use(StealthPlugin());

  const timeout = opts.timeoutMs ?? 30_000;
  const browser = await chromium.launch({ headless: true, timeout: 60_000 });
  const results: Array<{ url: string; html: string | null }> = [];

  try {
    for (const url of urls) {
      const page = await browser.newPage();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout });
        if (opts.waitSelector) {
          // The content we want may never appear (e.g. a genuinely empty page);
          // don't let a missing selector throw away a valid empty result.
          await page.waitForSelector(opts.waitSelector, { timeout }).catch(() => {});
        }
        results.push({ url, html: await page.content() });
      } catch (err: any) {
        console.error(`[browserFetch] failed to load ${url}: ${err.message}`);
        results.push({ url, html: null });
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}

/** Convenience single-URL wrapper around {@link fetchRenderedPages}. */
export async function fetchRenderedHtml(
  url: string,
  opts: FetchOptions = {}
): Promise<string | null> {
  const [result] = await fetchRenderedPages([url], opts);
  return result?.html ?? null;
}
