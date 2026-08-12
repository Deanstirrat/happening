"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// Persists per-URL scroll position so back/forward navigation (e.g. tapping an
// event card and hitting "back") returns the visitor to exactly where they were,
// instead of the top.
//
// Why this exists rather than relying on the App Router: the feed pages are
// `force-dynamic` and stream in. On a back navigation the router restores scroll
// before the streamed content has rendered — so it "restores" against a page
// that's momentarily ~0px tall and the visitor lands at the top. On top of that,
// per-day "show more" expansions live in client state and vanish on re-render,
// making the page shorter than it was. Both mean a single scrollTo can't land the
// right spot, so we re-apply the target across frames until the page has grown
// tall enough (or the visitor scrolls / we hit a deadline).

const PREFIX = "scroll:";
// How long to keep chasing the saved position while content streams/images load.
const RESTORE_MS = 1500;

// Tracks whether the most recent navigation was a history traversal (back/forward)
// vs. a fresh push. Set from popstate, which fires for the browser back/forward
// buttons and for router.back() (used by the event-detail BackButton), but NOT
// for forward Link clicks — so we only restore on genuine back/forward.
let pendingPop = false;
// Only the first mount of the session may fall back to navigation timing; after
// that, back/forward is signalled exclusively by popstate.
let firstMount = true;
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    pendingPop = true;
  });
}

// On a full page load (first paint or reload), popstate never fired, so fall back
// to the navigation timing entry to tell a reload / history load (restore) apart
// from a fresh visit (leave at top).
function initialLoadWantsRestore(): boolean {
  const [entry] = performance.getEntriesByType(
    "navigation"
  ) as PerformanceNavigationTiming[];
  return entry?.type === "back_forward" || entry?.type === "reload";
}

export default function ScrollMemory() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Key on the full URL so each filtered view restores independently.
  const qs = searchParams.toString();
  const key = PREFIX + pathname + (qs ? `?${qs}` : "");

  useEffect(() => {
    let restoring = false;
    let rafSave = 0;
    let rafRestore = 0;

    const save = () => {
      rafSave = 0;
      if (restoring) return; // don't clobber the target with mid-restore positions
      try {
        sessionStorage.setItem(key, String(window.scrollY));
      } catch {
        // sessionStorage can throw (private mode, quota) — scroll memory is a
        // nice-to-have, so silently give up.
      }
    };
    const onScroll = () => {
      if (!rafSave) rafSave = requestAnimationFrame(save);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", save);

    // Decide whether this mount is a back/forward we should restore for. On the
    // first mount there was no popstate to observe, so consult navigation timing
    // (reload / history load). Every later mount relies on popstate alone.
    const isTraversal = pendingPop || (firstMount && initialLoadWantsRestore());
    pendingPop = false;
    firstMount = false;

    let target = 0;
    try {
      target = Number(sessionStorage.getItem(key)) || 0;
    } catch {
      target = 0;
    }

    if (isTraversal && target > 0) {
      restoring = true;
      const deadline = performance.now() + RESTORE_MS;

      // A real user scroll aborts the restore so we never fight their input.
      const cancel = () => {
        restoring = false;
      };
      window.addEventListener("wheel", cancel, { passive: true });
      window.addEventListener("touchstart", cancel, { passive: true });
      window.addEventListener("keydown", cancel);

      const step = () => {
        if (!restoring) return; // canceled by user scroll
        window.scrollTo(0, target);
        // Reached it (page finally tall enough) — done.
        if (Math.abs(window.scrollY - target) <= 2) {
          restoring = false;
          return;
        }
        // Page still too short and time remains — keep chasing as it streams in.
        if (performance.now() < deadline) {
          rafRestore = requestAnimationFrame(step);
        } else {
          restoring = false;
        }
      };
      rafRestore = requestAnimationFrame(step);

      return () => {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("pagehide", save);
        window.removeEventListener("wheel", cancel);
        window.removeEventListener("touchstart", cancel);
        window.removeEventListener("keydown", cancel);
        if (rafSave) cancelAnimationFrame(rafSave);
        if (rafRestore) cancelAnimationFrame(rafRestore);
      };
    }

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", save);
      if (rafSave) cancelAnimationFrame(rafSave);
      if (rafRestore) cancelAnimationFrame(rafRestore);
    };
  }, [key]);

  return null;
}
