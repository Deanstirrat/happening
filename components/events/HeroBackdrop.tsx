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
          className={`object-cover scale-125 blur-3xl saturate-150 transition-opacity duration-[1500ms] ease-in-out ${
            i === index ? "opacity-45" : "opacity-0"
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
      {/* Legibility scrim + melt into the page background below */}
      <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/35 to-background" />
    </div>
  );
}
