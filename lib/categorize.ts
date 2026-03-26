import Anthropic from "@anthropic-ai/sdk";
import { EventCategory } from "@prisma/client";
import type { ScrapedEvent } from "./types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CATEGORIES = [
  "MUSIC_ELECTRONIC",
  "MUSIC_ROCK_PUNK",
  "MUSIC_JAZZ_BLUES",
  "MUSIC_HIPHOP",
  "MUSIC_SOUL_RNB",
  "MUSIC_CLASSICAL",
  "MUSIC_OTHER",
  "ART_GALLERY",
  "ART_PERFORMANCE",
  "COMEDY",
  "FOOD_DRINK",
  "NIGHTLIFE",
  "COMMUNITY",
  "TECH",
  "SPORTS_FITNESS",
  "FILM",
  "THEATER",
  "OUTDOOR",
  "FAMILY",
  "OTHER",
] as const;

const CATEGORY_PROMPT = `Categorize the following SF Bay Area event into exactly one category from this list:
${CATEGORIES.join(", ")}

Event title: {title}
Description: {description}
Venue: {venue}
Tags: {tags}

Reply with ONLY the category name, nothing else.`;

export async function categorizeEvent(event: ScrapedEvent): Promise<EventCategory> {
  if (!process.env.ANTHROPIC_API_KEY) return "OTHER";

  const prompt = CATEGORY_PROMPT
    .replace("{title}", event.title)
    .replace("{description}", (event.description ?? "").slice(0, 400))
    .replace("{venue}", event.venueName ?? "")
    .replace("{tags}", (event.tags ?? []).join(", "));

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 20,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = (msg.content[0] as any).text?.trim().toUpperCase() ?? "";
    const matched = CATEGORIES.find((c) => c === raw);
    return (matched ?? "OTHER") as EventCategory;
  } catch (e) {
    console.error("[categorize] error:", (e as Error).message);
    return "OTHER";
  }
}

/** Batch categorize — 5 concurrent, 1.5s delay between batches to stay under 50 req/min */
export async function categorizeEvents(
  events: ScrapedEvent[]
): Promise<EventCategory[]> {
  const BATCH = 5;
  const DELAY_MS = 6000; // 5 req per 6s = 50 req/min
  const results: EventCategory[] = [];

  for (let i = 0; i < events.length; i += BATCH) {
    const batch = events.slice(i, i + BATCH);
    const cats = await Promise.all(batch.map(categorizeEvent));
    results.push(...cats);
    if (i + BATCH < events.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  return results;
}
