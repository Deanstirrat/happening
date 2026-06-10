"use client";

import { useState } from "react";
import Image from "next/image";

interface Props {
  proxiedImageUrl: string | null | undefined;
  /** Image shown below the flyer: venue photo if known, else category tile. */
  fallbackImage: string | null;
  categoryColor: string;
  title: string;
  categoryLabel: string | null;
  tags: string[];
}

export default function EventFlyerContainer({
  proxiedImageUrl,
  fallbackImage,
  categoryColor,
  title,
  tags,
}: Props) {
  const [imgSrc, setImgSrc] = useState(proxiedImageUrl ?? fallbackImage);
  const [ratio, setRatio] = useState<number | null>(null);

  return (
    <div
      className={`relative rounded-lg overflow-hidden bg-surface-container${!ratio ? " min-h-[300px]" : ""}`}
      style={ratio ? { aspectRatio: ratio } : undefined}
    >
      {imgSrc ? (
        <Image
          src={imgSrc}
          alt={title}
          fill
          className="object-contain"
          sizes="(max-width: 1024px) 100vw, 50vw"
          priority
          onLoad={(e) => {
            const img = e.currentTarget;
            setRatio(img.naturalWidth / img.naturalHeight);
          }}
          onError={() => {
            if (imgSrc === proxiedImageUrl && fallbackImage) {
              setImgSrc(fallbackImage);
            } else {
              setImgSrc(null);
            }
          }}
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, ${categoryColor}44, ${categoryColor}11)`,
          }}
        />
      )}
      {tags.length > 0 && (
        <div className="absolute bottom-4 left-4 flex flex-wrap gap-1.5">
          {tags.slice(0, 4).map((tag) => (
            <span key={tag} className="chip text-[0.6rem]">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
