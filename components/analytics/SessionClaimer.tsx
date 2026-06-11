"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const SESSION_KEY = "happeningSessionId";

/**
 * After a magic-link login, migrate this browser's anonymous interest data into
 * the new account (issue #96). The verify route redirects to `/?claimed=1`; we
 * read that flag, POST the localStorage session id to /api/auth/claim-session,
 * then strip the flag from the URL so a refresh doesn't re-trigger it.
 *
 * Rendered only for signed-in users (see SessionSync), so the POST always has a
 * session cookie to authenticate against.
 */
export default function SessionClaimer() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("claimed") !== "1") return;

    let sessionId: string | null = null;
    try {
      sessionId = localStorage.getItem(SESSION_KEY);
    } catch {
      // localStorage unavailable — nothing to migrate.
    }

    // Strip ?claimed=1 regardless, so the effect runs at most once per login.
    const params = new URLSearchParams(searchParams.toString());
    params.delete("claimed");
    const qs = params.toString();
    router.replace(qs ? `/?${qs}` : "/");

    if (!sessionId) return;

    fetch("/api/auth/claim-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
      keepalive: true,
    }).catch(() => {
      // Best-effort; the anonymous data is still intact if this fails.
    });
  }, [searchParams, router]);

  return null;
}
