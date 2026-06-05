"use client";

import { useState } from "react";

interface EnrichResult {
  ok: boolean;
  processed: number;
  imagesFixed: number;
  imagesFromSearch: number;
  unfeatured: number;
  unfeaturedDetails: { id: string; title: string }[];
  descriptionsAdded: number;
  brokenSources: number;
  titleMismatches: { id: string; stored: string; page: string }[];
}

export default function EnrichFeatured({ secret }: { secret: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<EnrichResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  async function run() {
    setState("loading");
    setResult(null);
    try {
      const res = await fetch("/api/admin/curation/enrich-featured", {
        method: "POST",
        headers: { "x-scrape-secret": secret },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setResult(data);
      setState("done");
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  if (state === "idle" || state === "error") {
    return (
      <div className="flex flex-col gap-2 bg-surface-container rounded-2xl px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-body text-sm font-semibold text-on-surface">enrich featured</p>
            <p className="font-body text-xs text-on-surface-variant mt-0.5">
              Fix images (og: → web search), fill descriptions; un-feature if no image found
            </p>
          </div>
          <button
            onClick={run}
            className="btn-primary px-4 py-2 text-xs font-semibold shrink-0"
          >
            run
          </button>
        </div>
        {state === "error" && (
          <p className="font-body text-xs text-error">{errorMsg}</p>
        )}
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div className="flex items-center gap-3 bg-surface-container rounded-2xl px-5 py-4">
        <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
        <p className="font-body text-sm text-on-surface-variant">
          enriching featured events — check Railway logs for progress…
        </p>
      </div>
    );
  }

  // done
  return (
    <div className="flex flex-col gap-3 bg-surface-container rounded-2xl px-5 py-4">
      <div className="flex items-center justify-between">
        <p className="font-body text-sm font-semibold text-on-surface">enrich complete</p>
        <button
          onClick={() => setState("idle")}
          className="font-body text-xs text-on-surface-variant hover:text-on-surface transition-colors"
        >
          dismiss
        </button>
      </div>
      {result && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: "processed", value: result.processed },
            { label: "images fixed", value: result.imagesFixed },
            { label: "via web search", value: result.imagesFromSearch },
            { label: "un-featured", value: result.unfeatured },
            { label: "descriptions added", value: result.descriptionsAdded },
            { label: "broken sources", value: result.brokenSources },
          ].map(({ label, value }) => (
            <div key={label} className="bg-surface-container-high rounded-xl px-3 py-2 text-center">
              <p className="font-headline font-black text-xl text-on-surface">{value}</p>
              <p className="font-body text-[0.65rem] text-on-surface-variant">{label}</p>
            </div>
          ))}
        </div>
      )}
      {result && result.titleMismatches.length > 0 && (
        <div className="flex flex-col gap-1 mt-1">
          <p className="font-body text-xs font-semibold text-on-surface-variant">title mismatches (review manually)</p>
          {result.titleMismatches.map((m) => (
            <div key={m.id} className="font-body text-xs text-on-surface-variant">
              <span className="text-on-surface">{m.stored}</span>
              <span className="mx-1">→</span>
              <span className="italic">{m.page}</span>
            </div>
          ))}
        </div>
      )}
      {result && result.unfeatured > 0 && (
        <div className="flex flex-col gap-1 mt-1">
          <p className="font-body text-xs font-semibold text-on-surface-variant">un-featured — no usable image found</p>
          {result.unfeaturedDetails.map((u) => (
            <div key={u.id} className="font-body text-xs text-on-surface-variant">
              <span className="text-on-surface">{u.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
