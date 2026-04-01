import axios from "axios";
import * as cheerio from "cheerio";
import { extractEventFromCaption } from "@/lib/extract";
import type { ExtractedEvent } from "@/lib/extract";

// Domains we can reliably fetch event pages from
const RECOGNIZED_DOMAINS = new Set([
  "partiful.com",
  "ra.co",
  "residentadvisor.net",
  "lu.ma",
  "eventbrite.com",
  "eventbrite.co.uk",
  "posh.vip",
  "bandsintown.com",
  "songkick.com",
  "foopee.com",
  "funcheap.com",
  "sfjazz.org",
  "kqed.org",
  "dothebay.com",
  "19hz.info",
  "meetup.com",
  "timeout.com",
  "sfstation.com",
  "badslava.com",
  "sfpl.org",
  "sfrecpark.org",
  "medicinefornightmares.com",
  "omnivorebooks.com",
  "noevalleytownsquare.org",
  "citylights.com",
]);

export interface UrlExtractionResult {
  extracted: ExtractedEvent;
  imageUrl: string | null;
  sourceUrl: string;
}

export type ExtractFromUrlResult =
  | { success: true; data: UrlExtractionResult }
  | { unrecognized: true; domain: string }
  | { error: string };

export function isDomainRecognized(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return RECOGNIZED_DOMAINS.has(hostname.replace(/^www\./, ""));
  } catch {
    return false;
  }
}

export async function extractFromUrl(url: string): Promise<ExtractFromUrlResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "Invalid URL" };
  }

  const hostname = parsed.hostname.replace(/^www\./, "");

  if (!RECOGNIZED_DOMAINS.has(hostname)) {
    return { unrecognized: true, domain: hostname };
  }

  try {
    const { data: html } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; happening-sf/1.0)",
        Accept: "text/html",
      },
      timeout: 10000,
    });

    const $ = cheerio.load(html);

    const ogTitle = $('meta[property="og:title"]').attr("content") ?? "";
    const ogDescription = $('meta[property="og:description"]').attr("content") ?? "";
    const ogImage = $('meta[property="og:image"]').attr("content") ?? null;
    const pageTitle = $("title").text().trim();

    // Strip non-content elements before extracting body text
    $("script, style, nav, footer, header, [role='navigation']").remove();
    const bodyText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 3000);

    const textContext = [
      ogTitle && `Title: ${ogTitle}`,
      pageTitle && ogTitle !== pageTitle && `Page title: ${pageTitle}`,
      ogDescription && `Description: ${ogDescription}`,
      bodyText && `Page content: ${bodyText}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    if (!textContext.trim()) {
      return { error: "Could not extract any content from that page" };
    }

    const extracted = await extractEventFromCaption(textContext);

    return {
      success: true,
      data: {
        extracted,
        imageUrl: ogImage,
        sourceUrl: url,
      },
    };
  } catch (err: any) {
    if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
      return { error: "Could not reach that URL" };
    }
    if (err.response?.status === 403 || err.response?.status === 401) {
      return { error: "That page requires a login to view" };
    }
    if (err.response?.status === 404) {
      return { error: "That page was not found (404)" };
    }
    return { error: err.message ?? "Failed to fetch URL" };
  }
}
