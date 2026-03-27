"use client";

import { useState, useRef, useEffect } from "react";

export default function BugReportButton() {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open]);

  async function submit() {
    if (!description.trim()) return;
    setStatus("loading");
    try {
      const res = await fetch("/api/bug-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          pageUrl: window.location.href,
          userAgent: navigator.userAgent,
        }),
      });
      if (!res.ok) throw new Error();
      setStatus("success");
      setTimeout(() => {
        setOpen(false);
        setDescription("");
        setStatus("idle");
      }, 1500);
    } catch {
      setStatus("error");
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 font-body text-xs text-on-surface-variant hover:text-on-surface px-3 py-2 rounded-full bg-surface-container hover:bg-surface-container-high transition-colors"
      >
        report a bug
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="bg-surface-container rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4">
            <h2 className="font-headline font-bold text-lg text-on-surface lowercase">
              report a bug
            </h2>

            {status === "success" ? (
              <p className="font-body text-sm text-[#4ade80]">
                Got it — thanks for the report!
              </p>
            ) : (
              <>
                <textarea
                  ref={textareaRef}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What went wrong?"
                  rows={4}
                  className="w-full bg-surface-container-high rounded-xl px-4 py-3 font-body text-sm text-on-surface placeholder:text-on-surface-variant resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {status === "error" && (
                  <p className="font-body text-xs text-[#ef4444]">
                    Something went wrong. Please try again.
                  </p>
                )}
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setOpen(false)}
                    className="font-body text-sm px-4 py-2 rounded-full text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    cancel
                  </button>
                  <button
                    onClick={submit}
                    disabled={!description.trim() || status === "loading"}
                    className="font-body text-sm font-semibold px-4 py-2 rounded-full bg-primary text-on-primary hover:opacity-90 transition-opacity disabled:opacity-40"
                  >
                    {status === "loading" ? "sending…" : "send report"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
