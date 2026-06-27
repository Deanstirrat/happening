/**
 * Bounded-concurrency runner for AI (and other I/O) batch jobs.
 *
 * Replaces the hand-rolled "slice into batches of N, Promise.all, sleep" loops
 * that were scattered across the Claude call sites. Those loops were tuned for
 * the old Anthropic rate limits (~50 req/min); on the Scale tier (10k req/min,
 * 2M output-tok/min per model) the bottleneck was our own throttle, not the API.
 *
 * Concurrency is the real governor: at Haiku latency a pool of ~16 in-flight
 * calls sits far under 10k req/min while finishing jobs an order of magnitude
 * faster than the old serial-batch + sleep pace. `rpm` is an optional backstop
 * ceiling; transient 429/529 blips during a burst are absorbed by the shared
 * client's retry budget (see lib/anthropic.ts), so callers don't need their own
 * backoff.
 *
 * IMPORTANT: this caps Anthropic concurrency only. Per-call limits that are NOT
 * about Claude must stay enforced by their own code — Nominatim's 1 req/s
 * (lib/geocode.ts), a source site's politeness window, the Postgres connection
 * pool. Don't raise the cap so high those break.
 *
 * `fn` is expected to handle its own errors (every current call site already
 * returns a safe fallback rather than throwing). If `fn` rejects, the run
 * rejects — matching the old `Promise.all(batch.map(...))` behavior.
 */

/** Global default in-flight cap, overridable per call or via AI_CONCURRENCY. */
export const DEFAULT_AI_CONCURRENCY = Math.max(
  1,
  Number(process.env.AI_CONCURRENCY ?? "16")
);

export interface MapPoolOptions {
  /** Max in-flight calls. Defaults to DEFAULT_AI_CONCURRENCY. */
  concurrency?: number;
  /** Optional ceiling on calls *started* per minute. 0/undefined = uncapped. */
  rpm?: number;
  /** Invoked after each item settles, with (completed, total). */
  onProgress?: (done: number, total: number) => void;
}

export async function mapPool<I, O>(
  items: I[],
  fn: (item: I, index: number) => Promise<O>,
  options: MapPoolOptions = {}
): Promise<O[]> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_AI_CONCURRENCY);
  const rpm = options.rpm && options.rpm > 0 ? options.rpm : 0;
  const minIntervalMs = rpm ? 60_000 / rpm : 0;

  const results = new Array<O>(items.length);
  let cursor = 0;
  let done = 0;
  // Earliest timestamp the next call may start. Updated atomically (no await
  // between the read and the write below), so workers can't race past the gate.
  let nextSlot = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;

      if (minIntervalMs) {
        const now = Date.now();
        const wait = nextSlot - now;
        nextSlot = Math.max(now, nextSlot) + minIntervalMs;
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }

      results[index] = await fn(items[index], index);
      done++;
      options.onProgress?.(done, items.length);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}
