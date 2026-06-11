"use client";

import { useState } from "react";
import Image, { type ImageProps } from "next/image";

/**
 * next/image that fades in once loaded instead of popping. Pairs with the
 * .img-fade / .loaded classes in globals.css.
 */
export default function FadeImage({ className = "", alt, ...props }: ImageProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <Image
      {...props}
      alt={alt}
      className={`img-fade ${loaded ? "loaded" : ""} ${className}`}
      onLoad={() => setLoaded(true)}
    />
  );
}
