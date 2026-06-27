import Anthropic from "@anthropic-ai/sdk";
import { anthropic as client } from "./anthropic";

export interface ExtractedEvent {
  title: string | null;
  dateRaw: string | null;
  timeRaw: string | null;
  venueName: string | null;
  venueAddress: string | null;
  price: string | null;
  isFree: boolean;
  description: string | null;
  tags: string[];
}

// The SF-local date the extraction is running on. Giving the model an explicit
// "today" anchor stops it from inventing a year for year-less flyers — its main
// failure mode was emitting a date one+ years in the future (see parseDate's
// reanchorFarFuture guard in lib/createEvent.ts).
function todaySf(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

const EXTRACT_PROMPT = `You are extracting event details from a San Francisco event flyer or Instagram post.

Extract the following fields. If a field is not present or unclear, return null for it.

Return ONLY a valid JSON object with exactly these keys:
{
  "title": string | null,
  "dateRaw": string | null,
  "timeRaw": string | null,
  "venueName": string | null,
  "venueAddress": string | null,
  "price": string | null,
  "isFree": boolean,
  "description": string | null,
  "tags": string[]
}

Guidelines:
- title: The event name (not the venue or artist name if they differ)
- dateRaw: Date exactly as written on the post, e.g. "Saturday March 29". Do not convert to ISO. CRITICAL: only include a year if a year is explicitly printed on the flyer/post. If no year is shown, do NOT add or guess one — return just the weekday/month/day as written (e.g. "Saturday March 29", not "Saturday March 29, 2027"). The current date is provided below; use it only to disambiguate relative dates like "this Friday" or "tomorrow", never to fabricate a year that isn't on the post.
- timeRaw: Start time as written, e.g. "9pm" or "9:00 PM - 2:00 AM". Null if no time is shown — do NOT guess or default to midnight/"12:00 AM".
- venueName: Name of the venue or location
- venueAddress: Street address if present
- price: Ticket price as written, e.g. "$15", "$10-20 sliding scale". Null if not mentioned.
- isFree: true if explicitly free or no cover, false otherwise
- description: 1-3 sentence summary of the event — music genre, vibe, who's performing
- tags: 2-5 relevant lowercase tags like ["electronic", "rave", "warehouse", "techno"]

Do not include any explanation or markdown. Return only the JSON object.`;

export async function extractEventFromImage(
  imageBase64: string,
  mediaType: string,
  caption?: string
): Promise<ExtractedEvent> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const userContent: Anthropic.MessageParam["content"] = [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: imageBase64,
      },
    },
    {
      type: "text",
      text: caption
        ? `${EXTRACT_PROMPT}\n\nToday's date (San Francisco): ${todaySf()}\n\nInstagram caption:\n${caption}`
        : `${EXTRACT_PROMPT}\n\nToday's date (San Francisco): ${todaySf()}`,
    },
  ];

  const msg = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 512,
    messages: [{ role: "user", content: userContent }],
  });

  const raw = (msg.content[0] as any).text?.trim() ?? "";

  try {
    // Strip markdown code fences and trailing commas before closing braces/brackets
    const jsonStr = raw
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "")
      .replace(/,(\s*[}\]])/g, "$1");
    const parsed = JSON.parse(jsonStr);
    return {
      title: parsed.title ?? null,
      dateRaw: parsed.dateRaw ?? null,
      timeRaw: parsed.timeRaw ?? null,
      venueName: parsed.venueName ?? null,
      venueAddress: parsed.venueAddress ?? null,
      price: parsed.price ?? null,
      isFree: Boolean(parsed.isFree),
      description: parsed.description ?? null,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };
  } catch (e) {
    console.error("[extract] Failed to parse Claude response:", raw);
    throw new Error("Failed to parse event details from image");
  }
}

export async function extractEventFromCaption(caption: string): Promise<ExtractedEvent> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const prompt = `${EXTRACT_PROMPT}\n\nToday's date (San Francisco): ${todaySf()}\n\nInstagram caption / event description:\n${caption}`;

  const msg = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = (msg.content[0] as any).text?.trim() ?? "";

  try {
    const jsonStr = raw
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "")
      .replace(/,(\s*[}\]])/g, "$1");
    const parsed = JSON.parse(jsonStr);
    return {
      title: parsed.title ?? null,
      dateRaw: parsed.dateRaw ?? null,
      timeRaw: parsed.timeRaw ?? null,
      venueName: parsed.venueName ?? null,
      venueAddress: parsed.venueAddress ?? null,
      price: parsed.price ?? null,
      isFree: Boolean(parsed.isFree),
      description: parsed.description ?? null,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };
  } catch (e) {
    console.error("[extract] Failed to parse Claude response:", raw);
    throw new Error("Failed to parse event details from caption");
  }
}
