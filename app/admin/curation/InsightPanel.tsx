"use client";

import { useState } from "react";
import { format } from "date-fns";

interface Insight {
  weekOf: string;
  insight: string;
  createdAt: string;
}

export default function InsightPanel({
  latest,
}: {
  latest: Insight | null;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [current, setCurrent] = useState<Insight | null>(latest);
  const [errorMsg, setErrorMsg] = useState("");

  async function runReflection() {
    setState("loading");
    try {
      const res = await fetch("/api/admin/curation/reflect", {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.skipped) {
        setErrorMsg(data.message);
        setState("error");
        return;
      }
      setCurrent({ weekOf: data.weekOf, insight: data.insight, createdAt: new Date().toISOString() });
      setState("done");
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  const insightToShow = state === "done" ? current : latest;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-headline font-black text-lg text-on-surface lowercase">
          curation learnings
        </h2>
        <button
          onClick={runReflection}
          disabled={state === "loading"}
          className="font-body text-xs text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-40"
        >
          {state === "loading" ? "analysing…" : "run reflection"}
        </button>
      </div>

      {state === "error" && (
        <p className="font-body text-xs text-error">{errorMsg}</p>
      )}

      {insightToShow ? (
        <div className="bg-surface-container rounded-2xl px-5 py-4 flex flex-col gap-2">
          <p className="font-body text-[0.65rem] text-on-surface-variant">
            week of {format(new Date(insightToShow.weekOf), "MMM d, yyyy")}
            {insightToShow.createdAt && ` · generated ${format(new Date(insightToShow.createdAt), "MMM d")}`}
          </p>
          <div className="font-body text-sm text-on-surface whitespace-pre-wrap leading-relaxed">
            {insightToShow.insight}
          </div>
        </div>
      ) : (
        <div className="bg-surface-container rounded-2xl px-5 py-8 flex flex-col items-center gap-2">
          <p className="font-body text-sm text-on-surface-variant text-center max-w-sm">
            No learnings yet. Run a reflection after the first week of featured events to start improving the algo.
          </p>
        </div>
      )}
    </div>
  );
}
