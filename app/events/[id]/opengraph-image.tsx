import { ImageResponse } from "next/og";
import { prisma } from "@/lib/prisma";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "@/lib/types";
import { formatDateLongSF, formatTimeSF } from "@/lib/sfDate";
import { loadFlyerDataUrl, loadGoogleFont } from "@/lib/og";

// The flyer comes from the DB per-id, so this card is generated at request time
// rather than prerendered at build (no DB at build, always fresh after edits).
export const dynamic = "force-dynamic";

export const alt = "happening — event details";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Warm-dark design tokens, lifted from globals.css so the card reads as the app.
const BG = "#131211";
const CREAM = "#e9e5d8";
const MUTED = "#bdb7a9";
const RED = "#ff0000";
const OUTLINE = "#3d3933";
const SURFACE = "#1e1b18";

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await prisma.event.findUnique({
    where: { id },
    select: {
      title: true,
      startDate: true,
      allDay: true,
      imageUrl: true,
      venueName: true,
      neighborhood: true,
      category: true,
    },
  });

  const title = truncate((event?.title ?? "happening").toLowerCase(), 90);
  const dateLine = event
    ? event.allDay
      ? formatDateLongSF(event.startDate)
      : `${formatDateLongSF(event.startDate)} · ${formatTimeSF(event.startDate)}`
    : "san francisco bay area events";
  const venueLine = [event?.venueName, event?.neighborhood].filter(Boolean).join(" · ");
  const categoryLabel = event?.category ? CATEGORY_LABELS[event.category] : null;
  const accent = event?.category ? CATEGORY_COLORS[event.category] : RED;

  const flyer = await loadFlyerDataUrl(event?.imageUrl);

  // Subset each face to exactly the glyphs we draw to stay well under the bundle cap.
  const groteskText = `happening${title}`;
  const jakartaText = `${dateLine}${venueLine}${categoryLabel ?? ""}`;
  const [grotesk, jakarta] = await Promise.all([
    loadGoogleFont("Space Grotesk", 700, groteskText),
    loadGoogleFont("Plus Jakarta Sans", 500, jakartaText),
  ]);

  const fonts = [
    grotesk && { name: "Space Grotesk", data: grotesk, weight: 700 as const, style: "normal" as const },
    jakarta && { name: "Plus Jakarta Sans", data: jakarta, weight: 500 as const, style: "normal" as const },
  ].filter((f): f is NonNullable<typeof f> => Boolean(f));

  const headlineFont = grotesk ? "Space Grotesk" : "sans-serif";
  const bodyFont = jakarta ? "Plus Jakarta Sans" : "sans-serif";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "row",
          background: BG,
          fontFamily: bodyFont,
        }}
      >
        {/* Left: flyer art, or a category-tinted gradient when there's none. */}
        <div
          style={{
            width: 460,
            height: "100%",
            display: "flex",
            position: "relative",
            borderRight: `1px solid ${OUTLINE}`,
            background: `linear-gradient(135deg, ${accent}33, ${BG})`,
          }}
        >
          {flyer ? (
            <img
              src={flyer}
              alt=""
              width={460}
              height={630}
              style={{ width: 460, height: 630, objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                width: "100%",
                height: "100%",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: headlineFont,
                fontSize: 130,
                fontWeight: 700,
                color: accent,
              }}
            >
              ●
            </div>
          )}
        </div>

        {/* Right: wordmark, title, meta. */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: 64,
          }}
        >
          {/* Wordmark */}
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ width: 22, height: 22, background: RED, borderRadius: 5, marginRight: 14 }} />
            <div
              style={{
                fontFamily: headlineFont,
                fontWeight: 700,
                fontSize: 32,
                color: CREAM,
                letterSpacing: -0.5,
              }}
            >
              happening
            </div>
          </div>

          {/* Title */}
          <div
            style={{
              display: "flex",
              fontFamily: headlineFont,
              fontWeight: 700,
              fontSize: 64,
              lineHeight: 1.05,
              color: CREAM,
              letterSpacing: -1.5,
            }}
          >
            {title}
          </div>

          {/* Meta: category chip + date + venue */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            {categoryLabel && (
              <div style={{ display: "flex", marginBottom: 18 }}>
                <div
                  style={{
                    display: "flex",
                    background: `${accent}22`,
                    color: accent,
                    fontSize: 22,
                    fontWeight: 500,
                    padding: "8px 18px",
                    borderRadius: 999,
                    textTransform: "lowercase",
                  }}
                >
                  {categoryLabel}
                </div>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", fontSize: 30, color: CREAM }}>
              <div style={{ width: 10, height: 10, background: RED, borderRadius: 2, marginRight: 14 }} />
              {dateLine}
            </div>
            {venueLine && (
              <div style={{ display: "flex", fontSize: 26, color: MUTED, marginTop: 12, marginLeft: 24 }}>
                {venueLine}
              </div>
            )}
          </div>
        </div>

        {/* Bottom hairline accent bar for a touch of brand polish. */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 460,
            right: 0,
            height: 6,
            background: SURFACE,
          }}
        />
      </div>
    ),
    { ...size, fonts },
  );
}
