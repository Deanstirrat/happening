"use client";

import { useState, useRef, useEffect } from "react";

export default function BugReportButton() {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open]);

  function close() {
    setOpen(false);
    setDescription("");
    setEmail("");
    setStatus("idle");
  }

  async function submit() {
    if (!description.trim()) return;
    setStatus("loading");
    try {
      const res = await fetch("/api/bug-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          email: email.trim() || undefined,
          pageUrl: window.location.href,
          userAgent: navigator.userAgent,
        }),
      });
      if (!res.ok) throw new Error();
      setStatus("success");
      setTimeout(close, 2000);
    } catch {
      setStatus("error");
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-16 sm:bottom-4 right-4 z-40 font-body text-xs text-on-surface-variant hover:text-on-surface px-3 py-2 rounded-full bg-surface-container hover:bg-surface-container-high transition-colors"
      >
        report a bug
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="bg-surface-container-low w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl p-6 flex flex-col gap-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="font-headline font-bold text-base text-on-surface lowercase tracking-wide">
                report a bug
              </h2>
              <button
                onClick={close}
                className="text-on-surface-variant hover:text-on-surface transition-colors text-lg leading-none"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {status === "success" ? (
              <p className="font-body text-sm text-on-surface py-4 text-center">
                thanks for the report!
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-3">
                  <textarea
                    ref={textareaRef}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="what went wrong?"
                    rows={4}
                    className="w-full bg-surface-container rounded-xl px-4 py-3 font-body text-sm text-on-surface placeholder:text-on-surface-variant resize-none focus:outline-none focus:ring-1 focus:ring-outline"
                  />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email (optional, if you'd like a reply)"
                    className="w-full bg-surface-container rounded-xl px-4 py-3 font-body text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-1 focus:ring-outline"
                  />
                </div>

                {status === "error" && (
                  <p className="font-body text-xs text-error -mt-1">
                    something went wrong — please try again.
                  </p>
                )}

                <div className="flex gap-2 justify-end">
                  <button
                    onClick={close}
                    className="font-body text-sm px-4 py-2 rounded-full text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    cancel
                  </button>
                  <button
                    onClick={submit}
                    disabled={!description.trim() || status === "loading"}
                    className="font-body text-sm font-medium px-5 py-2 rounded-full bg-primary text-on-primary hover:opacity-90 transition-opacity disabled:opacity-40"
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
