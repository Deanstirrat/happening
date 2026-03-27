"use client";

import { useState } from "react";

export default function FeatureRequestForm() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    eventName: "",
    eventDate: "",
    eventUrl: "",
    message: "",
  });
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  function update(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    try {
      const res = await fetch("/api/feature-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Request failed");
      }
      setStatus("success");
    } catch (err) {
      setStatus("error");
    }
  }

  const inputClass =
    "w-full bg-surface-container rounded-xl px-4 py-3 font-body text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-1 focus:ring-primary";

  if (status === "success") {
    return (
      <div className="bg-surface-container rounded-2xl p-8 text-center">
        <p className="font-headline font-bold text-xl text-on-surface lowercase mb-2">
          we'll be in touch
        </p>
        <p className="font-body text-sm text-on-surface-variant">
          thanks for reaching out — we'll review your request and get back to you at {form.email}.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="font-body text-xs text-on-surface-variant uppercase tracking-wider">
            your name *
          </label>
          <input
            type="text"
            value={form.name}
            onChange={update("name")}
            placeholder="Jane Smith"
            required
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-body text-xs text-on-surface-variant uppercase tracking-wider">
            email *
          </label>
          <input
            type="email"
            value={form.email}
            onChange={update("email")}
            placeholder="jane@example.com"
            required
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="font-body text-xs text-on-surface-variant uppercase tracking-wider">
          event name *
        </label>
        <input
          type="text"
          value={form.eventName}
          onChange={update("eventName")}
          placeholder="My Amazing Event"
          required
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="font-body text-xs text-on-surface-variant uppercase tracking-wider">
            event date
          </label>
          <input
            type="text"
            value={form.eventDate}
            onChange={update("eventDate")}
            placeholder="e.g. April 12, 2026"
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-body text-xs text-on-surface-variant uppercase tracking-wider">
            event url
          </label>
          <input
            type="url"
            value={form.eventUrl}
            onChange={update("eventUrl")}
            placeholder="https://..."
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="font-body text-xs text-on-surface-variant uppercase tracking-wider">
          tell us about it *
        </label>
        <textarea
          value={form.message}
          onChange={update("message")}
          placeholder="What makes your event special? Who's it for? Any other context."
          rows={4}
          required
          className={`${inputClass} resize-none`}
        />
      </div>

      {status === "error" && (
        <p className="font-body text-xs text-[#ef4444]">
          Something went wrong. Please try again.
        </p>
      )}

      <button
        type="submit"
        disabled={status === "loading"}
        className="btn-primary py-3.5 text-sm font-semibold disabled:opacity-50"
      >
        {status === "loading" ? "sending…" : "submit request"}
      </button>
    </form>
  );
}
