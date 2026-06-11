"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { getSessionId } from "@/lib/sessionId";

export default function PageTracker() {
  const pathname = usePathname();

  useEffect(() => {
    try {
      const sessionId = getSessionId();
      fetch("/api/track/visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, path: pathname }),
        keepalive: true,
      });
    } catch {
      // ignore
    }
  }, [pathname]);

  return null;
}
