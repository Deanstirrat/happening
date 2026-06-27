import Anthropic from "@anthropic-ai/sdk";

/**
 * Shared Anthropic client for every server-side Claude call (scrapers,
 * categorize, merge, featured enrichment, curator). Centralizes two things:
 *
 *  1. The API key, so the key wiring lives in one place.
 *  2. A higher retry budget. The batch jobs run at real concurrency now (see
 *     lib/aiConcurrency.ts), so a burst can occasionally draw a transient 429
 *     (rate limit) or 529 (overloaded). The SDK retries exactly those, plus
 *     5xx, with exponential backoff — making high concurrency safe without each
 *     call site hand-rolling its own backoff. `maxRetries` is the SDK default (2)
 *     bumped to 4.
 *
 * Tune the retry budget with ANTHROPIC_MAX_RETRIES if needed.
 */
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxRetries: Number(process.env.ANTHROPIC_MAX_RETRIES ?? "4"),
});
