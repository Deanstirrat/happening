"use client";

import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    const res = await fetch("/api/auth/send-magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    if (res.ok) {
      setStatus("sent");
    } else {
      const data = await res.json().catch(() => ({}));
      setErrorMsg(data.error ?? "Something went wrong.");
      setStatus("error");
    }
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="font-headline font-black text-3xl text-on-surface lowercase mb-2">
          sign in
        </h1>
        <p className="font-body text-sm text-on-surface-variant mb-8">
          Enter your email and we&apos;ll send you a sign-in link.
        </p>

        {status === "sent" ? (
          <div className="bg-surface-container rounded-xl p-6 text-center">
            <p className="font-body text-on-surface text-sm mb-1 font-semibold">Check your email</p>
            <p className="font-body text-on-surface-variant text-xs">
              We sent a sign-in link to <span className="text-on-surface">{email}</span>.
              It expires in 15 minutes.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-surface-container rounded-lg px-4 py-3 text-sm font-body text-on-surface placeholder:text-on-surface-variant outline-none focus:ring-2 focus:ring-primary"
            />
            {status === "error" && (
              <p className="text-xs font-body text-red-400">{errorMsg}</p>
            )}
            <button
              type="submit"
              disabled={status === "loading"}
              className="btn-primary py-3 text-sm disabled:opacity-50"
            >
              {status === "loading" ? "sending…" : "send sign-in link"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
