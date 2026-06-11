"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

interface HeroBackdropProps {
  images: string[];
}

const ROTATE_MS = 7000;

/**
 * Cinematic rotating backdrop for the homepage hero: featured-event flyers,
 * heavily blurred and saturated, crossfading on a slow cycle. Renders the
 * first image server-side; rotation only kicks in after hydration.
 */
export default function HeroBackdrop({ images }: HeroBackdropProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (images.length <= 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % images.length),
      ROTATE_MS
    );
    return () => clearInterval(timer);
  }, [images.length]);

  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden>
      {images.map((src, i) => (
        <Image
          key={src}
          src={src}
          alt=""
          fill
          priority={i === 0}
          sizes="100vw"
          className={`object-cover scale-110 blur-2xl saturate-150 transition-opacity duration-[1500ms] ease-in-out ${
            i === index ? "opacity-80" : "opacity-0"
          }`}
        />
      ))}
      {/* Red ember glow anchoring the brand color, even with no images */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(90% 70% at 15% 0%, rgba(255,0,0,0.14), transparent 55%)",
        }}
      />
      {/* Light top scrim + strong bottom scrim where the headline sits, melting into the page */}
      <div className="absolute inset-0 bg-gradient-to-b from-background/45 via-background/15 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-background via-background/55 to-transparent" />
    </div>
  );
}
