const SESSION_KEY = "happeningSessionId";
// One year; the cookie just mirrors the (persistent) localStorage id.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Anonymous session id shared across interaction tracking, interest votes, and
 * page-visit analytics.
 *
 * localStorage is the source of truth. We also mirror it to a cookie so server
 * components can read it during render and personalize ranking (#99) — the
 * client-only localStorage value is invisible to the server. It's an anonymous
 * random id, so the cookie carries no more exposure than localStorage already
 * does (no httpOnly/Secure needed, and it must stay readable from JS).
 *
 * Client-only: relies on localStorage/document, so call from "use client" code.
 */
export function getSessionId(): string {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  document.cookie = `${SESSION_KEY}=${id}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  return id;
}
