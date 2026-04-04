"use client";

import { useState } from "react";
import Image from "next/image";

interface EventFlyerProps {
  proxiedImageUrl: string | null | undefined;
  categoryImage: string | null;
  categoryColor: string;
  title: string;
  categoryLabel: string | null;
}

export default function EventFlyer({
  proxiedImageUrl,
  categoryImage,
  categoryColor,
  title,
  categoryLabel,
}: EventFlyerProps) {
  const [imgSrc, setImgSrc] = useState(proxiedImageUrl ?? categoryImage);

  if (imgSrc) {
    return (
      <Image
        src={imgSrc}
        alt={title}
        fill
        className="object-cover"
        sizes="(max-width: 1024px) 100vw, 50vw"
        priority
        onError={() => {
          if (imgSrc === proxiedImageUrl && categoryImage) {
            setImgSrc(categoryImage);
          } else {
            setImgSrc(null);
          }
        }}
      />
    );
  }

  return (
    <div
      className="absolute inset-0"
      style={{
        background: `linear-gradient(135deg, ${categoryColor}44, ${categoryColor}11)`,
      }}
    />
  );
}
