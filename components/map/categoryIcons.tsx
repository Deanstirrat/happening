"use client";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Disc3,
  Guitar,
  Music4,
  Mic2,
  Mic,
  Piano,
  Music,
  Palette,
  Drama,
  Brush,
  Laugh,
  Dices,
  UtensilsCrossed,
  Martini,
  Users,
  Cpu,
  Presentation,
  Dumbbell,
  Film,
  VenetianMask,
  Trees,
  Baby,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

/**
 * An intuitive glyph for every event category. This replaces the old colour-only
 * key: the icon tells you what kind of event a marker is at a glance, while the
 * category colour is now just a secondary accent.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  MUSIC_ELECTRONIC: Disc3,
  MUSIC_ROCK_PUNK: Guitar,
  MUSIC_JAZZ_BLUES: Music4,
  MUSIC_HIPHOP: Mic2,
  MUSIC_RNB_SOUL: Mic,
  MUSIC_CLASSICAL: Piano,
  MUSIC_OTHER: Music,
  ART_GALLERY: Palette,
  ART_PERFORMANCE: Drama,
  ART_WORKSHOP: Brush,
  COMEDY: Laugh,
  TRIVIA_BINGO: Dices,
  FOOD_DRINK: UtensilsCrossed,
  NIGHTLIFE: Martini,
  COMMUNITY: Users,
  TECH: Cpu,
  TALKS_LECTURES: Presentation,
  SPORTS_FITNESS: Dumbbell,
  FILM: Film,
  THEATER: VenetianMask,
  OUTDOOR: Trees,
  FAMILY: Baby,
  OTHER: Sparkles,
};

export const FALLBACK_ICON: LucideIcon = Sparkles;

export function categoryIconComponent(
  category: string | null | undefined
): LucideIcon {
  return (category && CATEGORY_ICONS[category]) || FALLBACK_ICON;
}

interface GlyphOptions {
  size: number;
  color: string;
  strokeWidth?: number;
  fill?: string;
}

// Rendering a lucide glyph to an SVG string is comparatively expensive and the
// map paints one marker per event, so cache by the exact (glyph,size,colour)
// signature we request. Sizes are quantised by the caller, keeping this small.
const svgCache = new Map<string, string>();

function renderIcon(
  Icon: LucideIcon,
  { size, color, strokeWidth = 2, fill = "none" }: GlyphOptions
): string {
  const name = Icon.displayName || Icon.name || "icon";
  const key = `${name}|${size}|${color}|${strokeWidth}|${fill}`;
  const cached = svgCache.get(key);
  if (cached) return cached;
  const svg = renderToStaticMarkup(
    createElement(Icon, { size, color, strokeWidth, fill, absoluteStrokeWidth: true })
  );
  svgCache.set(key, svg);
  return svg;
}

/** SVG markup for a category's glyph, for embedding in a Leaflet divIcon. */
export function categoryIconSvg(
  category: string | null | undefined,
  opts: GlyphOptions
): string {
  return renderIcon(categoryIconComponent(category), opts);
}

/** SVG markup for an arbitrary lucide glyph (e.g. the featured / trending badges). */
export function glyphSvg(Icon: LucideIcon, opts: GlyphOptions): string {
  return renderIcon(Icon, opts);
}
