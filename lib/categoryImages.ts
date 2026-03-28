import { EventCategory } from "@prisma/client";

// Only categories with an actual image file in /public/category-images/.
// Categories not listed here will fall back to a gradient in the UI.
export const CATEGORY_IMAGES: Partial<Record<EventCategory, string>> = {
  MUSIC_ELECTRONIC: "/category-images/electronic.jpg",
  MUSIC_ROCK_PUNK: "/category-images/rock_punk.jpg",
  MUSIC_JAZZ_BLUES: "/category-images/jazz.jpg",
  MUSIC_HIPHOP: "/category-images/hiphop.jpg",
  MUSIC_RNB_SOUL: "/category-images/soul.jpg",
  MUSIC_OTHER: "/category-images/music.jpg",
  COMEDY: "/category-images/comedy.jpg",
  NIGHTLIFE: "/category-images/nightlife.jpg",
  OTHER: "/category-images/other.jpg",
};
