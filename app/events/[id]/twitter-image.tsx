// X/Twitter gets the same branded share card as Open Graph. Re-exporting the
// opengraph-image route keeps a single source of truth for the design.
export { default, alt, size, contentType, dynamic } from "./opengraph-image";
