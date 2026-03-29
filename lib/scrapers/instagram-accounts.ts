export type InstagramAccount = {
  handle: string;
  venueName: string;
  /** "venue" → image-first extraction (Claude vision)
   *  "promoter" → caption-first extraction (Claude haiku, cheaper) */
  tier: "venue" | "promoter";
};

/**
 * SF Instagram accounts to monitor for event posts.
 *
 * Venue accounts post structured flyers — vision extraction is worth the cost.
 * Promoter/DJ accounts put event details in the caption — text extraction suffices.
 *
 * Adding or removing accounts requires no code changes; just edit this list.
 */
export const INSTAGRAM_ACCOUNTS: InstagramAccount[] = [
  // ── Venues (physical spaces — use Claude vision) ─────────────────────────
  { handle: "slimssf",            venueName: "Slim's",             tier: "venue" },
  { handle: "bottomofthehillsf",  venueName: "Bottom of the Hill", tier: "venue" },
  { handle: "theindependentsf",   venueName: "The Independent",    tier: "venue" },
  { handle: "thefillmore",        venueName: "The Fillmore",       tier: "venue" },
  { handle: "cafedunord",         venueName: "Cafe du Nord",       tier: "venue" },
  { handle: "thewarfieldtheatre", venueName: "The Warfield",       tier: "venue" },
  { handle: "1015folsom",         venueName: "1015 Folsom",        tier: "venue" },
  { handle: "rickshawsf",         venueName: "Rickshaw Stop",      tier: "venue" },
  { handle: "august_hall_sf",     venueName: "August Hall",        tier: "venue" },
  { handle: "bimbossf",           venueName: "Bimbo's 365 Club",  tier: "venue" },

  // ── Promoters / DJs (caption-first — use Claude haiku) ───────────────────
  // Add handles here, e.g.:
  // { handle: "somepromotersf", venueName: "Some Promoter", tier: "promoter" },
];
