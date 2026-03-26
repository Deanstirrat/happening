"use client";

import { useState, useRef } from "react";
import { Upload, Link, Sparkles, CheckCircle, AlertCircle, Loader } from "lucide-react";
import type { ExtractedEvent } from "@/lib/extract";

type Tab = "flyer" | "instagram";

interface FormState {
  title: string;
  dateRaw: string;
  timeRaw: string;
  venueName: string;
  venueAddress: string;
  price: string;
  isFree: boolean;
  description: string;
  tags: string;
  sourceUrl: string;
  submitterNote: string;
}

const EMPTY: FormState = {
  title: "",
  dateRaw: "",
  timeRaw: "",
  venueName: "",
  venueAddress: "",
  price: "",
  isFree: false,
  description: "",
  tags: "",
  sourceUrl: "",
  submitterNote: "",
};

export default function SubmitForm() {
  const [tab, setTab] = useState<Tab>("flyer");
  const [form, setForm] = useState<FormState>(EMPTY);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "duplicate" | "error"; message: string; eventId?: string } | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setExtracted(false);
    setExtractError(null);
    const url = URL.createObjectURL(file);
    setImagePreview(url);
  }

  function applyExtracted(data: ExtractedEvent & { sourceUrl?: string }) {
    setForm((prev) => ({
      ...prev,
      title: data.title ?? prev.title,
      dateRaw: data.dateRaw ?? prev.dateRaw,
      timeRaw: data.timeRaw ?? prev.timeRaw,
      venueName: data.venueName ?? prev.venueName,
      venueAddress: data.venueAddress ?? prev.venueAddress,
      price: data.price ?? prev.price,
      isFree: data.isFree ?? prev.isFree,
      description: data.description ?? prev.description,
      tags: data.tags?.join(", ") ?? prev.tags,
      sourceUrl: data.sourceUrl ?? prev.sourceUrl,
    }));
    setExtracted(true);
  }

  async function handleExtract() {
    setExtracting(true);
    setExtractError(null);
    try {
      if (tab === "flyer" && imageFile) {
        const fd = new FormData();
        fd.append("image", imageFile);
        if (caption) fd.append("caption", caption);
        const res = await fetch("/api/submit/extract", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Extraction failed");
        applyExtracted(data);
      } else if (tab === "instagram") {
        if (!caption.trim()) {
          setExtractError("Paste the Instagram caption to extract details.");
          return;
        }
        const res = await fetch("/api/submit/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caption, instagramUrl: instagramUrl || null }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Extraction failed");
        applyExtracted({ ...data, sourceUrl: instagramUrl || data.sourceUrl });
        if (instagramUrl) setForm((p) => ({ ...p, sourceUrl: instagramUrl }));
      }
    } catch (e: any) {
      setExtractError(e.message);
    } finally {
      setExtracting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          tags: form.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ type: "error", message: data.error ?? "Submission failed" });
      } else if (data.duplicate) {
        setResult({ type: "duplicate", message: "This event is already in the system.", eventId: data.eventId });
      } else {
        setResult({ type: "success", message: "Thanks! Your submission is under review and will appear soon.", eventId: data.eventId });
        setForm(EMPTY);
        setImageFile(null);
        setImagePreview(null);
        setCaption("");
        setInstagramUrl("");
        setExtracted(false);
      }
    } catch (e: any) {
      setResult({ type: "error", message: e.message });
    } finally {
      setSubmitting(false);
    }
  }

  const canExtract = tab === "flyer" ? !!imageFile : !!caption.trim();

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* Tabs */}
      <div className="flex gap-1 bg-surface-container-low p-1 rounded-full w-fit">
        {(["flyer", "instagram"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setTab(t); setExtracted(false); setExtractError(null); }}
            className={`font-body text-xs font-semibold uppercase tracking-widest px-4 py-1.5 rounded-full transition-colors ${
              tab === t
                ? "bg-surface-container text-on-surface"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {t === "flyer" ? "Upload Flyer" : "Paste Text"}
          </button>
        ))}
      </div>

      {/* Input section */}
      {tab === "flyer" ? (
        <div className="flex flex-col gap-4">
          {/* Image upload */}
          <div
            onClick={() => fileRef.current?.click()}
            className={`relative border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors ${
              imagePreview
                ? "border-on-surface-variant/30"
                : "border-on-surface-variant/20 hover:border-on-surface-variant/40"
            }`}
          >
            {imagePreview ? (
              <img src={imagePreview} alt="Flyer preview" className="max-h-64 rounded-xl object-contain" />
            ) : (
              <>
                <Upload size={24} className="text-on-surface-variant" />
                <p className="font-body text-sm text-on-surface-variant text-center">
                  Click to upload a flyer or screenshot
                  <br />
                  <span className="text-xs opacity-60">JPG, PNG, WEBP up to 10MB</span>
                </p>
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageChange}
            />
          </div>

          {/* Optional caption */}
          <div>
            <label className="font-body text-xs text-on-surface-variant uppercase tracking-widest mb-1.5 block">
              Caption (optional — helps with extraction)
            </label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Paste the Instagram caption here for better results..."
              rows={3}
              className="w-full bg-surface-container-low text-on-surface text-sm px-4 py-2.5 rounded-xl outline-none focus:bg-surface-container placeholder:text-on-surface-variant font-body transition-colors resize-none"
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Source URL */}
          <div>
            <label className="font-body text-xs text-on-surface-variant uppercase tracking-widest mb-1.5 block">
              Source URL (optional)
            </label>
            <div className="relative">
              <Link size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
              <input
                type="url"
                value={instagramUrl}
                onChange={(e) => setInstagramUrl(e.target.value)}
                placeholder="Instagram, Facebook, Partiful, artist website..."
                className="w-full bg-surface-container-low text-on-surface text-sm pl-9 pr-4 py-2.5 rounded-xl outline-none focus:bg-surface-container placeholder:text-on-surface-variant font-body transition-colors"
              />
            </div>
          </div>

          {/* Caption */}
          <div>
            <label className="font-body text-xs text-on-surface-variant uppercase tracking-widest mb-1.5 block">
              Event Text <span className="text-[#ef4444]">*</span>
            </label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Paste the post caption, event description, or any text with the event details..."
              rows={5}
              required
              className="w-full bg-surface-container-low text-on-surface text-sm px-4 py-2.5 rounded-xl outline-none focus:bg-surface-container placeholder:text-on-surface-variant font-body transition-colors resize-none"
            />
            <p className="font-body text-xs text-on-surface-variant mt-1 opacity-70">
              Works with Instagram, Facebook, Partiful, or any text with event info.
            </p>
          </div>
        </div>
      )}

      {/* Extract button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleExtract}
          disabled={!canExtract || extracting}
          className="flex items-center gap-2 font-body text-sm font-semibold px-5 py-2 rounded-full bg-surface-container text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-40"
        >
          {extracting ? (
            <Loader size={14} className="animate-spin" />
          ) : (
            <Sparkles size={14} />
          )}
          {extracting ? "Extracting..." : "Extract Details with AI"}
        </button>
        {extracted && (
          <span className="flex items-center gap-1.5 font-body text-xs text-[#4ade80]">
            <CheckCircle size={13} />
            Details auto-filled — review below
          </span>
        )}
        {extractError && (
          <span className="flex items-center gap-1.5 font-body text-xs text-[#ef4444]">
            <AlertCircle size={13} />
            {extractError}
          </span>
        )}
      </div>

      {/* Event detail fields */}
      <div className="flex flex-col gap-4">
        <h3 className="font-headline font-bold text-sm text-on-surface uppercase tracking-widest">
          Event Details
        </h3>

        <Field label="Event Title" required>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            placeholder="e.g. Honey Soundsystem at Public Works"
            required
            className="input-field"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Date" required>
            <input
              type="text"
              value={form.dateRaw}
              onChange={(e) => setForm((p) => ({ ...p, dateRaw: e.target.value }))}
              placeholder="e.g. March 29, 2026"
              required
              className="input-field"
            />
          </Field>
          <Field label="Time">
            <input
              type="text"
              value={form.timeRaw}
              onChange={(e) => setForm((p) => ({ ...p, timeRaw: e.target.value }))}
              placeholder="e.g. 9pm – 2am"
              className="input-field"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Venue Name">
            <input
              type="text"
              value={form.venueName}
              onChange={(e) => setForm((p) => ({ ...p, venueName: e.target.value }))}
              placeholder="e.g. Public Works"
              className="input-field"
            />
          </Field>
          <Field label="Address">
            <input
              type="text"
              value={form.venueAddress}
              onChange={(e) => setForm((p) => ({ ...p, venueAddress: e.target.value }))}
              placeholder="e.g. 161 Erie St"
              className="input-field"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Price">
            <input
              type="text"
              value={form.price}
              onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))}
              placeholder="e.g. $15, Free, PWYW"
              className="input-field"
            />
          </Field>
          <Field label="">
            <label className="flex items-center gap-2 cursor-pointer mt-5">
              <input
                type="checkbox"
                checked={form.isFree}
                onChange={(e) => setForm((p) => ({ ...p, isFree: e.target.checked }))}
                className="accent-[#a855f7]"
              />
              <span className="font-body text-sm text-on-surface">Free event</span>
            </label>
          </Field>
        </div>

        <Field label="Description">
          <textarea
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            placeholder="What's the vibe? Who's playing?"
            rows={3}
            className="input-field resize-none"
          />
        </Field>

        <Field label="Tags">
          <input
            type="text"
            value={form.tags}
            onChange={(e) => setForm((p) => ({ ...p, tags: e.target.value }))}
            placeholder="e.g. electronic, rave, warehouse (comma-separated)"
            className="input-field"
          />
        </Field>

        <Field label="Source URL">
          <input
            type="url"
            value={form.sourceUrl}
            onChange={(e) => setForm((p) => ({ ...p, sourceUrl: e.target.value }))}
            placeholder="Instagram post, event page, etc."
            className="input-field"
          />
        </Field>

        <Field label="Note (optional)">
          <input
            type="text"
            value={form.submitterNote}
            onChange={(e) => setForm((p) => ({ ...p, submitterNote: e.target.value }))}
            placeholder="Anything the reviewer should know?"
            className="input-field"
          />
        </Field>
      </div>

      {/* Result message */}
      {result && (
        <div
          className={`flex items-start gap-3 p-4 rounded-xl font-body text-sm ${
            result.type === "success"
              ? "bg-[#4ade80]/10 text-[#4ade80]"
              : result.type === "duplicate"
              ? "bg-[#f59e0b]/10 text-[#f59e0b]"
              : "bg-[#ef4444]/10 text-[#ef4444]"
          }`}
        >
          {result.type === "success" ? (
            <CheckCircle size={16} className="shrink-0 mt-0.5" />
          ) : (
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
          )}
          {result.message}
        </div>
      )}

      {/* Submit button */}
      <button
        type="submit"
        disabled={submitting || result?.type === "success"}
        className="font-body text-sm font-semibold px-6 py-3 rounded-full bg-on-surface text-surface hover:opacity-90 transition-opacity disabled:opacity-40 self-start"
      >
        {submitting ? "Submitting..." : "Submit Event"}
      </button>

      <style jsx>{`
        .input-field {
          width: 100%;
          background: var(--color-surface-container-low);
          color: var(--color-on-surface);
          font-size: 0.875rem;
          padding: 0.625rem 1rem;
          border-radius: 0.75rem;
          outline: none;
          font-family: var(--font-body);
          transition: background 0.15s;
        }
        .input-field:focus {
          background: var(--color-surface-container);
        }
        .input-field::placeholder {
          color: var(--color-on-surface-variant);
        }
      `}</style>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      {label && (
        <label className="font-body text-xs text-on-surface-variant uppercase tracking-widest mb-1.5 block">
          {label}
          {required && <span className="text-[#ef4444] ml-1">*</span>}
        </label>
      )}
      {children}
    </div>
  );
}
