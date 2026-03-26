import { EventCategory } from "@prisma/client";

export const CATEGORY_IMAGES: Record<EventCategory, string> = {
  MUSIC_ELECTRONIC: "/category-images/electronic.jpg",
  MUSIC_ROCK_PUNK: "/category-images/punk.jpg",
  MUSIC_JAZZ_BLUES: "/category-images/jazz.jpg",
  MUSIC_HIPHOP: "/category-images/hiphop.jpg",
  MUSIC_RNB_SOUL: "/category-images/rnb.jpg",
  MUSIC_CLASSICAL: "/category-images/classical.jpg",
  MUSIC_OTHER: "/category-images/music.jpg",
  ART_GALLERY: "/category-images/gallery.jpg",
  ART_PERFORMANCE: "/category-images/performance.jpg",
  COMEDY: "/category-images/comedy.jpg",
  FOOD_DRINK: "/category-images/food.jpg",
  NIGHTLIFE: "/category-images/nightlife.jpg",
  COMMUNITY: "/category-images/community.jpg",
  TECH: "/category-images/tech.jpg",
  SPORTS_FITNESS: "/category-images/sports.jpg",
  FILM: "/category-images/film.jpg",
  THEATER: "/category-images/theater.jpg",
  OUTDOOR: "/category-images/outdoor.jpg",
  FAMILY: "/category-images/family.jpg",
  OTHER: "/category-images/other.jpg",
};
