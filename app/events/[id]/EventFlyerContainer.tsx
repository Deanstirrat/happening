"use client";

import { useState } from "react";
import Image from "next/image";

interface Props {
  proxiedImageUrl: string | null | undefined;
  categoryImage: string | null;
  categoryColor: string;
  title: string;
  categoryLabel: string | null;
  tags: string[];
}

export default function EventFlyerContainer({
  proxiedImageUrl,
  categoryImage,
  categoryColor,
  title,
  tags,
}: Props) {
  const [imgSrc, setImgSrc] = useState(proxiedImageUrl ?? categoryImage);
  const [orientation, setOrientation] = useState<"portrait" | "landscape" | null>(null);

  const aspectClass = orientation === "landscape" ? "aspect-[4/3]" : "aspect-[3/4]";
  const minHClass = orientation === null ? "min-h-[300px]" : "";

  return (
    <div className={`relative ${aspectClass} ${minHClass} rounded-lg overflow-hidden bg-surface-container`}>
      {imgSrc ? (
        <Image
          src={imgSrc}
          alt={title}
          fill
          className="object-cover"
          sizes="(max-width: 1024px) 100vw, 50vw"
          priority
          onLoad={(e) => {
            const img = e.currentTarget;
            setOrientation(img.naturalWidth > img.naturalHeight ? "landscape" : "portrait");
          }}
          onError={() => {
            if (imgSrc === proxiedImageUrl && categoryImage) {
              setImgSrc(categoryImage);
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
