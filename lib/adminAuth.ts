import { NextRequest } from "next/server";

export function checkAuth(req: NextRequest): boolean {
  const secret = process.env.SCRAPE_SECRET;
  if (!secret) return false;
  return req.headers.get("x-scrape-secret") === secret;
}
