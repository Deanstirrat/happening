"use client";

import { Flag, X, Check, Loader2 } from "lucide-react";
import { useState } from "react";

export default function ReportButton({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    try {
      const res = await fetch(`/api/events/${eventId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment, email }),
      });
      if (!res.ok) throw new Error();
      setStatus("success");
    } catch {
      setStatus("error");
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-on-surface-variant hover:text-on-surface transition-colors text-xs font-body"
      >
        <Flag size={11} />
        report an issue
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4">
      <div className="bg-surface rounded-2xl w-full max-w-md p-6 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h2 className="font-headline font-bold text-lg text-on-surface lowercase">
            report an issue
          </h2>
          <button
            onClick={() => { setOpen(false); setStatus("idle"); }}
            className="text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {status === "success" ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <Check size={28} className="text-primary" />
            <p className="font-body text-sm text-on-surface">thanks for the heads up!</p>
            <button
              onClick={() => { setOpen(false); setStatus("idle"); }}
              className="btn-secondary text-xs px-4 py-2"
            >
              close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="font-body text-xs text-on-surface-variant uppercase tracking-wider">
                what&apos;s wrong? <span className="normal-case">(optional)</span>
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="wrong date, cancelled, duplicate listing…"
                rows={3}
                className="bg-surface-container rounded-lg px-3 py-2.5 text-sm font-body text-on-surface placeholder:text-on-surface-variant resize-none outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="font-body text-xs text-on-surface-variant uppercase tracking-wider">
                email <span className="normal-case">(optional — so we can follow up)</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="bg-surface-container rounded-lg px-3 py-2.5 text-sm font-body text-on-surface placeholder:text-on-surface-variant outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {status === "error" && (
              <p className="font-body text-xs text-red-400">something went wrong — try again</p>
            )}

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => { setOpen(false); setStatus("idle"); }}
                className="btn-secondary text-xs px-4 py-2"
              >
                cancel
              </button>
              <button
                type="submit"
                disabled={status === "loading"}
                className="btn-primary text-xs px-4 py-2 flex items-center gap-2 disabled:opacity-60"
              >
                {status === "loading" && <Loader2 size={12} className="animate-spin" />}
                submit report
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
