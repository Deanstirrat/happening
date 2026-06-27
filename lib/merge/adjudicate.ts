/**
 * LLM layer for semantic merge, using Claude Haiku (same model the categorizer
 * uses). Two jobs:
 *   1. adjudicatePair  — decide whether two candidate events are the same event.
 *   2. synthesizeCluster — compose one superior title + description from a
 *      confirmed cluster of duplicates.
 *
 * Both fail safe: on any API/parse error adjudication returns "not the same"
 * (so we never merge on uncertainty) and synthesis returns null (so the caller
 * falls back to deterministic best-of-each values).
 */
import Anthropic from "@anthropic-ai/sdk";
import { sfDayKey, sfDayStart } from "@/lib/sfDate";
import { anthropic as client } from "@/lib/anthropic";
/** Model used for adjudication + synthesis. Exported so callers can record which
 * model produced a persisted verdict (see DuplicateVerdict). */
export const ADJUDICATE_MODEL = "claude-haiku-4-5";
const MODEL = ADJUDICATE_MODEL;

export interface AdjudicationInput {
  title: string;
  startDate: Date;
  allDay: boolean;
  venueName: string | null;
  description: string | null;
}

/**
 * True when an event has no reliable start time: flagged allDay, or sitting at
 * the noon-SF placeholder several scrapers assign when a source gives a date but
 * no time (mirrors isTimeUnknown in lib/scrapers/runner.ts). Such a time is
 * meaningless for matching — feeding it to the adjudicator as a real start makes
 * Haiku read a placeholder noon vs a real 8pm as two different time slots and
 * wrongly split a genuine duplicate.
 */
function isTimeUnknown(startDate: Date, allDay: boolean): boolean {
  if (allDay) return true;
  const noonSf = sfDayStart(sfDayKey(startDate)).getTime() + 12 * 60 * 60 * 1000;
  return startDate.getTime() === noonSf;
}

export interface AdjudicationResult {
  same: boolean;
  confidence: number; // 0..1
  reason: string;
}

function fmt(e: AdjudicationInput): string {
  const start = isTimeUnknown(e.startDate, e.allDay)
    ? `${sfDayKey(e.startDate)} (date only — start time unknown)`
    : e.startDate.toISOString();
  return [
    `Title: ${e.title}`,
    `Start: ${start}`,
    `Venue: ${e.venueName ?? "(unknown)"}`,
    `Description: ${(e.description ?? "").slice(0, 300) || "(none)"}`,
  ].join("\n");
}

function extractText(msg: Anthropic.Message): string {
  const block = msg.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text : "";
}

/** Pull the first JSON object out of an LLM response, tolerating prose/fences. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const ADJUDICATE_PROMPT = `You decide whether two San Francisco event listings describe the SAME real-world event (same happening, same day, same place) that appears twice because two sources listed it differently.

Two listings are the SAME event when they refer to one occurrence — even if titles are reworded, one drops the headliner or promoter, abbreviations differ, or descriptions are paraphrased.

They are DIFFERENT events when they are separate occurrences: different shows at the same venue, different time slots of a recurring series (e.g. "Early Show" vs "Late Show"), different artists, or merely the same venue on the same night with unrelated programming.

If a listing's start is marked "date only — start time unknown", treat its time as missing: do NOT use a time difference against it as evidence the two are different time slots.

Listing A:
{a}

Listing B:
{b}

Respond with ONLY a JSON object, no prose:
{"same": <true|false>, "confidence": <0..1>, "reason": "<short>"}`;

export async function adjudicatePair(
  a: AdjudicationInput,
  b: AdjudicationInput
): Promise<AdjudicationResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { same: false, confidence: 0, reason: "no API key" };
  }
  const prompt = ADJUDICATE_PROMPT.replace("{a}", fmt(a)).replace("{b}", fmt(b));
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
    });
    const parsed = parseJsonObject(extractText(msg));
    if (!parsed || typeof parsed.same !== "boolean") {
      return { same: false, confidence: 0, reason: "unparseable response" };
    }
    const confidence =
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0;
    const reason = typeof parsed.reason === "string" ? parsed.reason : "";
    return { same: parsed.same, confidence, reason };
  } catch (e) {
    console.error("[merge/adjudicate] error:", (e as Error).message);
    return { same: false, confidence: 0, reason: "api error" };
  }
}

export interface SynthesisInput {
  title: string;
  description: string | null;
  venueName: string | null;
}

export interface SynthesisResult {
  title: string;
  description: string | null;
}

const SYNTHESIZE_PROMPT = `These listings are all the SAME San Francisco event, scraped from different sources. Produce the single best title and description by combining the highest-quality information from each.

Rules:
- Title: clear and specific, no source/promoter noise, no ALL CAPS, no trailing venue if it duplicates the venue field. Prefer the version that names the actual act/event.
- Description: the most informative accurate version. You may merge details, but do NOT invent facts not present in the inputs. If none of the inputs has a usable description, return null for description.
- Do not add marketing fluff.

Listings:
{listings}

Respond with ONLY a JSON object, no prose:
{"title": "<best title>", "description": <"best description" or null>}`;

export async function synthesizeCluster(
  members: SynthesisInput[]
): Promise<SynthesisResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const listings = members
    .map((m, i) =>
      [
        `[${i + 1}] Title: ${m.title}`,
        `    Venue: ${m.venueName ?? "(unknown)"}`,
        `    Description: ${(m.description ?? "").slice(0, 500) || "(none)"}`,
      ].join("\n")
    )
    .join("\n\n");
  const prompt = SYNTHESIZE_PROMPT.replace("{listings}", listings);
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });
    const parsed = parseJsonObject(extractText(msg));
    if (!parsed || typeof parsed.title !== "string" || !parsed.title.trim()) {
      return null;
    }
    const description =
      typeof parsed.description === "string" && parsed.description.trim()
        ? parsed.description.trim()
        : null;
    return { title: parsed.title.trim(), description };
  } catch (e) {
    console.error("[merge/synthesize] error:", (e as Error).message);
    return null;
  }
}
