"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SERVICE_OPTIONS = [
  { value: "CLAUDE_CODE", label: "Claude Code" },
  { value: "CLAUDE_API", label: "Claude API" },
  { value: "APIFY", label: "Apify" },
  { value: "RAILWAY", label: "Railway" },
  { value: "OTHER", label: "Other" },
] as const;

export default function AddCostForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default billing month = current month
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const data = new FormData(form);

    const service = data.get("service") as string;
    const amount = parseFloat(data.get("amount") as string);
    const monthStr = data.get("billingMonth") as string; // "YYYY-MM"
    const notes = (data.get("notes") as string).trim() || undefined;

    if (!monthStr) {
      setError("Select a billing month.");
      return;
    }

    const [year, month] = monthStr.split("-").map(Number);
    const billingMonth = new Date(Date.UTC(year, month - 1, 1)).toISOString();

    setLoading(true);
    try {
      const res = await fetch("/api/admin/costs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ service, amount, billingMonth, notes }),
      });
      if (!res.ok) {
        const j = await res.json();
        setError(j.error ?? "Failed to save.");
        return;
      }
      form.reset();
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 items-end">
      <div className="flex flex-col gap-1">
        <label className="font-body text-xs text-on-surface-variant">service</label>
        <select
          name="service"
          required
          className="font-body text-sm bg-surface-container-high text-on-surface rounded-xl px-3 py-2 border border-outline-variant focus:outline-none focus:border-primary"
        >
          {SERVICE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="font-body text-xs text-on-surface-variant">amount (USD)</label>
        <input
          name="amount"
          type="number"
          min="0.01"
          step="0.01"
          placeholder="0.00"
          required
          className="font-body text-sm bg-surface-container-high text-on-surface rounded-xl px-3 py-2 border border-outline-variant focus:outline-none focus:border-primary w-28"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="font-body text-xs text-on-surface-variant">billing month</label>
        <input
          name="billingMonth"
          type="month"
          defaultValue={defaultMonth}
          required
          className="font-body text-sm bg-surface-container-high text-on-surface rounded-xl px-3 py-2 border border-outline-variant focus:outline-none focus:border-primary"
        />
      </div>

      <div className="flex flex-col gap-1 flex-1 min-w-40">
        <label className="font-body text-xs text-on-surface-variant">notes (optional)</label>
        <input
          name="notes"
          type="text"
          placeholder="e.g. Max plan, starter tier…"
          className="font-body text-sm bg-surface-container-high text-on-surface rounded-xl px-3 py-2 border border-outline-variant focus:outline-none focus:border-primary"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="font-body text-sm font-semibold px-5 py-2 rounded-xl bg-primary text-on-primary hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {loading ? "adding…" : "add entry"}
      </button>

      {error && <p className="w-full font-body text-xs text-error">{error}</p>}
    </form>
  );
}
