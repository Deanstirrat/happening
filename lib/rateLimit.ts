// Minimal in-memory fixed-window rate limiter. Sufficient for the single-instance
// Railway deployment; swap for a shared store (Redis) if we ever scale horizontally.
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Returns true if the request is allowed, false if the limit has been exceeded.
 * Counts one hit against `key` per call within the current window.
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    // Opportunistically prune expired buckets so the map can't grow unbounded.
    if (buckets.size > 1000) {
      for (const [k, b] of buckets) {
        if (now >= b.resetAt) buckets.delete(k);
      }
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

/** Best-effort client IP from proxy headers (Railway/Vercel set x-forwarded-for). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
