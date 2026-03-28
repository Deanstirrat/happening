"use client";

import { Share2, Check } from "lucide-react";
import { useState } from "react";

export default function ShareButton({ title, large }: { title: string; large?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        // user cancelled — no-op
      }
    } else {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (large) {
    return (
      <button
        onClick={handleShare}
        className="btn-secondary w-full py-3 text-sm flex items-center justify-center gap-2"
      >
        {copied ? (
          <>
            <Check size={14} className="text-primary" />
            link copied
          </>
        ) : (
          <>
            <Share2 size={14} />
            share
          </>
        )}
      </button>
    );
  }

  return (
    <button
      onClick={handleShare}
      className="text-on-surface-variant hover:text-on-surface transition-colors"
      aria-label="Share event"
    >
      {copied ? <Check size={16} className="text-primary" /> : <Share2 size={16} />}
    </button>
  );
}
