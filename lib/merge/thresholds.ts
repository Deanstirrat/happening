/**
 * Shared confidence thresholds for the semantic-merge review pipeline, so the
 * nightly cron (scripts/merge-dups.ts) and the admin dedup UI agree on the bands.
 *
 * Given an adjudicator verdict { same, confidence } (confidence = how sure it is
 * of its own same/different call):
 *
 *   same && confidence >= MERGE_CONFIDENCE
 *       → cron auto-merges; never shown for review (loser is archived).
 *   same && REVIEW_FLOOR <= confidence < MERGE_CONFIDENCE
 *       → the UNCERTAIN band: leaned-duplicate but not sure enough to auto-merge.
 *         This is the only set a human reviews.
 *   confidence < REVIEW_FLOOR, or !same
 *       → adjudicator was confident it is NOT a merge; hidden from review. The
 *         nightly auto-merge remains the safety net for any it gets wrong.
 *
 * Both are env-tunable without a redeploy. Widen REVIEW_FLOOR down (e.g. 0.2) to
 * pull more borderline pairs into the human queue; raise it to shrink the queue.
 */
export const MERGE_CONFIDENCE = Number(process.env.MERGE_CONFIDENCE ?? "0.75");
export const REVIEW_FLOOR = Number(process.env.DEDUP_REVIEW_FLOOR ?? "0.4");
