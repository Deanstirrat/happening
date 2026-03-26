import { EventCategory } from "@prisma/client";

export type { EventCategory };

export interface EventSummary {
  id: string;
  title: string;
  startDate: string;
  endDate: string | null;
  venueName: string | null;
  venueAddress: string | null;
  neighborhood: string | null;
  category: EventCategory | null;
  price: string | null;
  isFree: boolean;
  imageUrl: string | null;
  sourceUrl: string;
  tags: string[];
  latitude: number | null;
  longitude: number | null;
  source: {
    slug: string;
    name: string;
  };
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
  venueName?: string;
  venueAddress?: string;
  sourceUrl: string;
  imageUrl?: string;
  price?: string;
  isFree?: boolean;
  tags?: string[];
  latitude?: number;
  longitude?: number;
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
  FOOD_DRINK: "Food & Drink",
  NIGHTLIFE: "Nightlife",
  COMMUNITY: "Community",
  TECH: "Tech",
  SPORTS_FITNESS: "Sports & Fitness",
  FILM: "Film",
  THEATER: "Theater",
  OUTDOOR: "Outdoor",
  FAMILY: "Family",
  OTHER: "Other",
};

export const CATEGORY_COLORS: Record<string, string> = {
  MUSIC_ELECTRONIC: "#3891fe",
  MUSIC_ROCK_PUNK: "#ff727c",
  MUSIC_JAZZ_BLUES: "#adc7ff",
  MUSIC_HIPHOP: "#a8c8ff",
  MUSIC_SOUL_RNB: "#ffb3b5",
  MUSIC_CLASSICAL: "#debfbf",
  MUSIC_OTHER: "#ffb3b5",
  ART_GALLERY: "#699eff",
  ART_PERFORMANCE: "#ffb3b5",
  COMEDY: "#ffb3b5",
  FOOD_DRINK: "#adc7ff",
  NIGHTLIFE: "#ff727c",
  COMMUNITY: "#a8c8ff",
  TECH: "#3891fe",
  SPORTS_FITNESS: "#adc7ff",
  FILM: "#debfbf",
  THEATER: "#ffb3b5",
  OUTDOOR: "#a8c8ff",
  FAMILY: "#adc7ff",
  OTHER: "#574142",
};
