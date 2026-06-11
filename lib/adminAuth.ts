import { NextRequest } from "next/server";

// Header-based shared secret for MACHINE callers only (cron jobs, scrape
// triggers). Human admins authenticate via session cookie + ADMIN role — see
// getAdminUser in lib/auth.ts. Do not reintroduce this as a URL query param:
// URL-borne secrets leak via browser history, server logs, and the Referer
// header.
export function checkAuth(req: NextRequest): boolean {
  const secret = process.env.SCRAPE_SECRET;
  if (!secret) return false;
  return req.headers.get("x-scrape-secret") === secret;
}
