import { EventCategory } from "@prisma/client";
import type { ScrapedEvent } from "./types";
import { anthropic as client } from "./anthropic";
import { mapPool } from "./aiConcurrency";

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
  "ART_WORKSHOP",
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
MUSIC_ELECTRONIC, MUSIC_ROCK_PUNK, MUSIC_JAZZ_BLUES, MUSIC_HIPHOP, MUSIC_RNB_SOUL, MUSIC_CLASSICAL, MUSIC_OTHER, ART_GALLERY, ART_PERFORMANCE, ART_WORKSHOP, COMEDY, TRIVIA_BINGO, FOOD_DRINK, NIGHTLIFE, COMMUNITY, TECH, TALKS_LECTURES, SPORTS_FITNESS, FILM, THEATER, OUTDOOR, FAMILY, OTHER

Category guidance:
- MUSIC_ELECTRONIC: techno, house, ambient, EDM, industrial, synthwave, EBM, darkwave, noise, DJ sets
- MUSIC_ROCK_PUNK: guitar-driven rock, indie rock, punk, hardcore, emo, metal, alternative, folk-rock
- MUSIC_JAZZ_BLUES: jazz, blues, swing, soul-jazz, big band, gospel
- MUSIC_HIPHOP: rap, hip-hop, trap, conscious hip-hop, spoken word rap
- MUSIC_RNB_SOUL: R&B, soul, funk, neo-soul, Afrobeats, reggae, Latin music, world music
- MUSIC_CLASSICAL: orchestral, chamber music, opera, contemporary classical
- MUSIC_OTHER: concerts or music events that don't fit the above music genres
- NIGHTLIFE: DJ parties, club nights, dance parties, bar events where the primary draw is the social/dance experience rather than a specific artist
- ART_GALLERY: visual art on display you VIEW — gallery and museum exhibitions, art shows, opening receptions, artist talks tied to a show, free museum days, public art and murals. Static visual art you look at, not a live performance.
- ART_PERFORMANCE: art you WATCH happen live — dance performances, circus, spoken word, immersive performance, variety shows. NOT gallery exhibitions (use ART_GALLERY) and NOT hands-on classes (use ART_WORKSHOP).
- ART_WORKSHOP: hands-on art/craft sessions where attendees MAKE something — painting and paint-and-sip nights, watercolor, drawing classes, ceramics/pottery, block/screen printing, candle or soap making, floral arranging, jewelry, knitting/crochet/sewing/fiber, collage, zine-making, life drawing. Pick this even if the title says "art" or the venue is a gallery, as long as the audience is making things.
- THEATER: plays, musicals, improv, stand-up comedy shows at theaters, magic shows
- COMEDY: comedy showcases, open mics, stand-up shows at bars/clubs
- TRIVIA_BINGO: games and trivia — pub/bar trivia, bingo, mahjong, chess, board game nights, card games, poker, dominoes, Scrabble, and other game socials or competitions
- COMMUNITY: neighborhood events, social mixers, communal meals/dinners, networking, activism, markets, volunteer events
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

/**
 * Batch categorize. Runs with bounded concurrency (see lib/aiConcurrency.ts) —
 * the categorizer makes one short Haiku call per event with no DB work in the
 * map, so it's safe to run at the global AI_CONCURRENCY default. Override with
 * CATEGORIZE_CONCURRENCY for an unusually large scrape.
 */
export async function categorizeEvents(
  events: ScrapedEvent[]
): Promise<EventCategory[]> {
  const concurrency = process.env.CATEGORIZE_CONCURRENCY
    ? Number(process.env.CATEGORIZE_CONCURRENCY)
    : undefined;
  return mapPool(events, categorizeEvent, { concurrency });
}
