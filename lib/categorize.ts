import Anthropic from "@anthropic-ai/sdk";
import { EventCategory } from "@prisma/client";
import type { ScrapedEvent } from "./types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CATEGORIES = [
  "MUSIC_ELECTRONIC",
  "MUSIC_ROCK_PUNK",
  "MUSIC_JAZZ_BLUES",
  "MUSIC_HIPHOP",
  "MUSIC_RNB_SOUL",
  "MUSIC_CLASSICAL",
  "MUSIC_OTHER",
  "ART_GALLERY",
  "ART_PERFORMANCE",
  "COMEDY",
  "TRIVIA_BINGO",
  "FOOD_DRINK",
  "NIGHTLIFE",
  "COMMUNITY",
  "TECH",
  "TALKS_LECTURES",
  "SPORTS_FITNESS",
  "FILM",
  "THEATER",
  "OUTDOOR",
  "FAMILY",
  "OTHER",
] as const;

// Tags that foopee (and some other sources) apply to all events regardless of genre.
// These are not meaningful signals and must be excluded before categorization.
const GENERIC_SOURCE_TAGS = new Set(["punk", "rock", "diy"]);

const CATEGORY_PROMPT = `Categorize the following SF Bay Area event into exactly one category from this list:
MUSIC_ELECTRONIC, MUSIC_ROCK_PUNK, MUSIC_JAZZ_BLUES, MUSIC_HIPHOP, MUSIC_RNB_SOUL, MUSIC_CLASSICAL, MUSIC_OTHER, ART_GALLERY, ART_PERFORMANCE, COMEDY, TRIVIA_BINGO, FOOD_DRINK, NIGHTLIFE, COMMUNITY, TECH, TALKS_LECTURES, SPORTS_FITNESS, FILM, THEATER, OUTDOOR, FAMILY, OTHER

Category guidance:
- MUSIC_ELECTRONIC: techno, house, ambient, EDM, industrial, synthwave, EBM, darkwave, noise, DJ sets
- MUSIC_ROCK_PUNK: guitar-driven rock, indie rock, punk, hardcore, emo, metal, alternative, folk-rock
- MUSIC_JAZZ_BLUES: jazz, blues, swing, soul-jazz, big band, gospel
- MUSIC_HIPHOP: rap, hip-hop, trap, conscious hip-hop, spoken word rap
- MUSIC_RNB_SOUL: R&B, soul, funk, neo-soul, Afrobeats, reggae, Latin music, world music
- MUSIC_CLASSICAL: orchestral, chamber music, opera, contemporary classical
- MUSIC_OTHER: concerts or music events that don't fit the above music genres
- NIGHTLIFE: DJ parties, club nights, dance parties, bar events where the primary draw is the social/dance experience rather than a specific artist
- ART_PERFORMANCE: dance performances, circus, spoken word, immersive art, variety shows
- THEATER: plays, musicals, improv, stand-up comedy shows at theaters, magic shows
- COMEDY: comedy showcases, open mics, stand-up shows at bars/clubs
- TRIVIA_BINGO: pub trivia nights, bar trivia, bingo nights, trivia competitions
- COMMUNITY: neighborhood events, social mixers, networking, activism, markets, volunteer events
- TECH: tech talks, hackathons, startup events, software/hardware demos
- TALKS_LECTURES: talks, lectures, panels, cocktail-hour educational events (Nerd Nite, Curiosity Guild, Profs & Pints, Science on Tap), author readings, public lectures, history tours, astronomy events, science outreach
- SPORTS_FITNESS: athletic events, fitness classes, recreational sports (not viewing parties)
- OUTDOOR: hikes, nature events, park activities, outdoor markets
- OTHER: anything that clearly doesn't fit any category above

Ignore generic tags like "punk", "rock", or "diy" if they contradict the title and description.

Event title: {title}
Description: {description}
Venue: {venue}
Tags: {tags}

Reply with ONLY the category name, nothing else.`;

export async function categorizeEvent(event: ScrapedEvent): Promise<EventCategory> {
  if (!process.env.ANTHROPIC_API_KEY) return "OTHER";

  const tags = (event.tags ?? []).filter((t) => !GENERIC_SOURCE_TAGS.has(t.toLowerCase()));
  const prompt = CATEGORY_PROMPT
    .replace("{title}", event.title)
    .replace("{description}", (event.description ?? "").slice(0, 400))
    .replace("{venue}", event.venueName ?? "")
    .replace("{tags}", tags.join(", "));

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
