"use client";

import { useState } from "react";
import Image from "next/image";

interface CategoryImageProps {
  src: string;
  alt: string;
  sizes: string;
  gradient: string;
  /** Extra Tailwind classes applied to the <Image> (e.g. transition/scale) */
  imageClassName?: string;
}

/**
 * Renders a category fallback image with an onError handler that swaps to the
 * gradient if the image file is missing or fails to load.
 */
export function CategoryImage({
  src,
  alt,
  sizes,
  gradient,
  imageClassName = "object-cover",
}: CategoryImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="absolute inset-0" style={{ background: gradient }} />
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      className={imageClassName}
      sizes={sizes}
      onError={() => setFailed(true)}
    />
  );
}
