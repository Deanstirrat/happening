import HeroBackdrop from "./HeroBackdrop";

interface HeroProps {
  title: string;
  subtitle?: string;
  total: number;
  tonightCount: number;
  images: string[];
}

function sfDateLine(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
  })
    .format(new Date())
    .toLowerCase();
}

/**
 * Full-bleed cinematic opener for the homepage: featured flyer art as a
 * blurred rotating backdrop, oversized lowercase headline, live counts.
 * Entrance is pure CSS (.hero-enter) so it works without JS and respects
 * prefers-reduced-motion.
 */
export default function Hero({ title, subtitle, total, tonightCount, images }: HeroProps) {
  return (
    <section className="relative -mt-px min-h-[17rem] h-[32vh] max-h-[23rem] flex items-center">
      <HeroBackdrop images={images} />

      <div className="relative w-full max-w-screen-xl mx-auto px-4 sm:px-6 py-8">
        <p
          className="hero-enter flex items-center gap-2 font-label text-[0.7rem] sm:text-xs font-semibold uppercase tracking-[0.25em] text-on-surface-variant mb-3"
          style={{ "--d": "80ms" } as React.CSSProperties}
        >
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
          {sfDateLine()}
        </p>

        <h1
          className="hero-enter font-headline font-black text-5xl sm:text-6xl lg:text-7xl text-on-surface lowercase leading-[0.92] tracking-tight"
          style={{ "--d": "180ms" } as React.CSSProperties}
        >
          {title}
          <span className="text-primary">.</span>
        </h1>

        <div
          className="hero-enter mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 font-body text-sm text-on-surface-variant"
          style={{ "--d": "320ms" } as React.CSSProperties}
        >
          {subtitle ? (
            <span>{subtitle}</span>
          ) : (
            <>
              <span>
                <strong className="text-on-surface font-bold tabular-nums">
                  {total.toLocaleString()}
                </strong>{" "}
                upcoming event{total !== 1 ? "s" : ""}
              </span>
              {tonightCount > 0 && (
                <span className="flex items-center gap-5">
                  <span className="h-1 w-1 rounded-full bg-outline-variant" aria-hidden />
                  <span>
                    <strong className="text-on-surface font-bold tabular-nums">
                      {tonightCount.toLocaleString()}
                    </strong>{" "}
                    tonight
                  </span>
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
