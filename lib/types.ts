import { EventCategory } from "@prisma/client";

export type { EventCategory };

export interface EventSummary {
  id: string;
  title: string;
  startDate: string;
  endDate: string | null;
  allDay: boolean;
  venueName: string | null;
  venueAddress: string | null;
  neighborhood: string | null;
  category: EventCategory | null;
  price: string | null;
  isFree: boolean;
  imageUrl: string | null;
  sourceUrl: string;
  tags: string[];
  performers: string[];
  latitude: number | null;
  longitude: number | null;
  featured: boolean;
  featuredAt: string | null;
  source: {
    slug: string;
    name: string;
  };
  spotifyMatch?: boolean;
}

export interface EventDetail extends EventSummary {
  description: string | null;
}

export interface EventsResponse {
  events: EventSummary[];
  total: number;
  page: number;
  totalPages: number;
}

export interface ScrapedEvent {
  externalId?: string;
  title: string;
  description?: string;
  startDate: Date;
  endDate?: Date;
  allDay?: boolean;
  venueName?: string;
  venueAddress?: string;
  sourceUrl: string;
  imageUrl?: string;
  price?: string;
  isFree?: boolean;
  tags?: string[];
  performers?: string[];
  latitude?: number;
  longitude?: number;
  category?: string;
}

export const SF_NEIGHBORHOODS = [
  "Bayview",
  "Bernal Heights",
  "Castro",
  "Chinatown",
  "Civic Center",
  "Cole Valley",
  "Cow Hollow",
  "Crocker Amazon",
  "Diamond Heights",
  "Dogpatch",
  "Excelsior",
  "Financial District",
  "Glen Park",
  "Haight-Ashbury",
  "Hayes Valley",
  "Inner Richmond",
  "Inner Sunset",
  "Japantown",
  "Lower Haight",
  "Lower Pacific Heights",
  "Marina",
  "Mission",
  "Mission Bay",
  "Nob Hill",
  "Noe Valley",
  "North Beach",
  "Outer Richmond",
  "Outer Sunset",
  "Pacific Heights",
  "Portola",
  "Potrero Hill",
  "Russian Hill",
  "SoMa",
  "Tenderloin",
  "Twin Peaks",
  "Union Square",
  "Upper Market",
  "Visitacion Valley",
  "West Portal",
  "Western Addition",
] as const;

export const MUSIC_CATEGORIES = [
  "MUSIC_ELECTRONIC",
  "MUSIC_ROCK_PUNK",
  "MUSIC_JAZZ_BLUES",
  "MUSIC_HIPHOP",
  "MUSIC_SOUL_RNB",
  "MUSIC_CLASSICAL",
  "MUSIC_OTHER",
] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  MUSIC_ELECTRONIC: "Electronic",
  MUSIC_ROCK_PUNK: "Rock / Punk",
  MUSIC_JAZZ_BLUES: "Jazz & Blues",
  MUSIC_HIPHOP: "Hip-Hop",
  MUSIC_SOUL_RNB: "Soul / R&B",
  MUSIC_CLASSICAL: "Classical",
  MUSIC_OTHER: "Music",
  ART_GALLERY: "Art & Gallery",
  ART_PERFORMANCE: "Performance",
  COMEDY: "Comedy",
  TRIVIA_BINGO: "Trivia & Bingo",
  FOOD_DRINK: "Food & Drink",
  NIGHTLIFE: "Nightlife",
  COMMUNITY: "Community",
  TECH: "Tech",
  TALKS_LECTURES: "Talks & Lectures",
  SPORTS_FITNESS: "Sports & Fitness",
  FILM: "Film",
  THEATER: "Theater",
  OUTDOOR: "Outdoor",
  FAMILY: "Family",
  OTHER: "Other",
};

export const NON_MUSIC_CATEGORIES = [
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

export const CATEGORY_COLORS: Record<string, string> = {
  MUSIC_ELECTRONIC: "#a855f7",
  MUSIC_ROCK_PUNK: "#ec4899",
  MUSIC_JAZZ_BLUES: "#38bdf8",
  MUSIC_HIPHOP: "#f59e0b",
  MUSIC_CLASSICAL: "#d4a574",
  MUSIC_OTHER: "#c084fc",
  ART_GALLERY: "#f97316",
  ART_PERFORMANCE: "#eab308",
  COMEDY: "#84cc16",
  TRIVIA_BINGO: "#f59e0b",
  FOOD_DRINK: "#22c55e",
  NIGHTLIFE: "#ef4444",
  COMMUNITY: "#14b8a6",
  TECH: "#60a5fa",
  TALKS_LECTURES: "#f0a500",
  SPORTS_FITNESS: "#fb923c",
  FILM: "#94a3b8",
  THEATER: "#e879f9",
  OUTDOOR: "#4ade80",
  FAMILY: "#818cf8",
  OTHER: "#78716c",
};
