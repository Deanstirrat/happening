// X/Twitter gets the same branded share card as Open Graph. Re-exporting the
// opengraph-image route keeps a single source of truth for the design.
export { default, alt, size, contentType } from "./opengraph-image";

// Route segment config must be statically parseable, so `dynamic` can't be
// re-exported — it's declared here to match opengraph-image's request-time render.
export const dynamic = "force-dynamic";
