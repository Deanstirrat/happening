import Link from "next/link";

/**
 * Branded empty state: minimal Golden Gate line illustration in the app's
 * cream/red palette instead of a bare emoji.
 */
export default function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-6 text-center">
      <svg
        width="240"
        height="140"
        viewBox="0 0 240 140"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
        className="opacity-90"
      >
        {/* setting sun */}
        <circle cx="120" cy="58" r="17" fill="#ff0000" opacity="0.8" />
        <circle cx="120" cy="58" r="26" fill="#ff0000" opacity="0.12" />
        {/* suspension cables */}
        <g stroke="#bdb7a9" strokeWidth="2" strokeLinecap="round" opacity="0.55">
          <path d="M0 62 Q 36 96 70 38" />
          <path d="M70 38 Q 120 100 170 38" />
          <path d="M170 38 Q 204 96 240 62" />
        </g>
        {/* towers */}
        <g stroke="#e9e5d8" strokeWidth="3" strokeLinecap="round" opacity="0.75">
          <path d="M70 30 V 104" />
          <path d="M170 30 V 104" />
        </g>
        <g stroke="#e9e5d8" strokeWidth="2" strokeLinecap="round" opacity="0.45">
          <path d="M63 52 H 77" />
          <path d="M63 72 H 77" />
          <path d="M163 52 H 177" />
          <path d="M163 72 H 177" />
        </g>
        {/* deck */}
        <g stroke="#bdb7a9" strokeWidth="2.5" strokeLinecap="round" opacity="0.7">
          <path d="M0 104 H 240" />
        </g>
        {/* fog bands */}
        <g fill="#e9e5d8">
          <rect x="28" y="114" width="92" height="5" rx="2.5" opacity="0.1" />
          <rect x="132" y="114" width="64" height="5" rx="2.5" opacity="0.07" />
          <rect x="58" y="124" width="120" height="5" rx="2.5" opacity="0.05" />
        </g>
      </svg>

      <div>
        <h3 className="font-headline font-bold text-xl text-on-surface lowercase">
          nothing&rsquo;s happening here&hellip; yet
        </h3>
        <p className="font-body text-sm text-on-surface-variant mt-2">
          no events match these filters. cast a wider net &mdash; more dates, fewer filters.
        </p>
      </div>

      <Link href="/" className="btn-secondary px-5 py-2.5 text-sm">
        clear all filters
      </Link>
    </div>
  );
}
