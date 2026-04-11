"use client";

import { useState, useRef } from "react";
import {
  Upload,
  Link,
  Pencil,
  Sparkles,
  CheckCircle,
  AlertCircle,
  Loader,
  ArrowLeft,
  ArrowRight,
  Image as ImageIcon,
  Calendar,
  Clock,
  MapPin,
} from "lucide-react";
import type { ExtractedEvent } from "@/lib/extract";

// ─── Types ───────────────────────────────────────────────────────────────────

type Step = "import" | "preview" | "details" | "success";

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
  category: string;
  imageUrl: string;
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
  category: "",
  imageUrl: "",
};

const CATEGORY_OPTIONS = [
  { value: "", label: "Auto-detect" },
  { value: "MUSIC_ELECTRONIC", label: "Electronic" },
  { value: "MUSIC_ROCK_PUNK", label: "Rock / Punk" },
  { value: "MUSIC_JAZZ_BLUES", label: "Jazz / Blues" },
  { value: "MUSIC_HIPHOP", label: "Hip Hop" },
  { value: "MUSIC_RNB_SOUL", label: "R&B / Soul" },
  { value: "MUSIC_CLASSICAL", label: "Classical" },
  { value: "MUSIC_OTHER", label: "Music (Other)" },
  { value: "ART_GALLERY", label: "Art Gallery" },
  { value: "ART_PERFORMANCE", label: "Performance Art" },
  { value: "COMEDY", label: "Comedy" },
  { value: "FOOD_DRINK", label: "Food & Drink" },
  { value: "NIGHTLIFE", label: "Nightlife" },
  { value: "COMMUNITY", label: "Community" },
  { value: "TECH", label: "Tech" },
  { value: "TALKS_LECTURES", label: "Talks & Lectures" },
  { value: "SPORTS_FITNESS", label: "Sports & Fitness" },
  { value: "FILM", label: "Film" },
  { value: "THEATER", label: "Theater" },
  { value: "OUTDOOR", label: "Outdoor" },
  { value: "FAMILY", label: "Family" },
  { value: "OTHER", label: "Other" },
];

// ─── Date/time conversion helpers ────────────────────────────────────────────

function toDatePickerValue(dateRaw: string): string {
  if (!dateRaw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return dateRaw;
  const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const match = dateRaw.match(
    /(?:(?:mon|tue|wed|thu|fri|sat|sun)\w*[\s,]+)?(\w+)\s+(\d{1,2})(?:[,\s]+(\d{4}))?/i
  );
  if (match) {
    const monthKey = match[1].slice(0, 3).toLowerCase();
    const month = MONTHS[monthKey];
    const day = parseInt(match[2]);
    const year = match[3] ? parseInt(match[3]) : new Date().getFullYear();
    if (month && day) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return "";
}

function toTimePickerValue(timeRaw: string): string {
  if (!timeRaw) return "";
  if (/^\d{2}:\d{2}$/.test(timeRaw)) return timeRaw;
  const start = timeRaw.split(/\s*[-–—]\s*/)[0].trim();
  const match = start.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (match) {
    let hours = parseInt(match[1]);
    const mins = parseInt(match[2] ?? "0");
    const meridiem = match[3]?.toLowerCase();
    if (meridiem === "pm" && hours !== 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
  }
  return "";
}

// ─── Display formatters (for preview card) ────────────────────────────────────

function formatDateForDisplay(dateStr: string): string {
  if (!dateStr) return "";
  // dateStr is YYYY-MM-DD from the date picker
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return "";
  // Construct in local time to avoid UTC midnight → prev-day shift
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimeForDisplay(timeStr: string): string {
  if (!timeStr) return "";
  // timeStr is HH:MM from the time picker
  const [h, min] = timeStr.split(":").map(Number);
  if (h === undefined || min === undefined) return "";
  const date = new Date(2000, 0, 1, h, min);
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SubmitWizard({ fromFeature = false }: { fromFeature?: boolean }) {
  const [step, setStep] = useState<Step>("import");
  const [form, setForm] = useState<FormState>(EMPTY);
  const [cameFromDetails, setCameFromDetails] = useState(false);

  // Import step state
  const [urlInput, setUrlInput] = useState("");
  const [flyerFile, setFlyerFile] = useState<File | null>(null);
  const [flyerPreview, setFlyerPreview] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [unknownSourceUrl, setUnknownSourceUrl] = useState<string | null>(null);

  // Image state for details step (separate from extracted image URL)
  const [imageTab, setImageTab] = useState<"upload" | "url">("upload");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    type: "success" | "duplicate" | "error";
    message: string;
    eventId?: string;
  } | null>(null);

  const flyerRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function applyExtracted(data: ExtractedEvent & { imageUrl?: string | null; sourceUrl?: string }) {
    setForm((prev) => ({
      ...prev,
      title: data.title ?? prev.title,
      dateRaw: data.dateRaw ? (toDatePickerValue(data.dateRaw) || data.dateRaw) : prev.dateRaw,
      timeRaw: data.timeRaw ? (toTimePickerValue(data.timeRaw) || data.timeRaw) : prev.timeRaw,
      venueName: data.venueName ?? prev.venueName,
      venueAddress: data.venueAddress ?? prev.venueAddress,
      price: data.price ?? prev.price,
      isFree: data.isFree ?? prev.isFree,
      description: data.description ?? prev.description,
      tags: data.tags?.join(", ") ?? prev.tags,
      sourceUrl: data.sourceUrl ?? prev.sourceUrl,
      imageUrl: data.imageUrl ?? prev.imageUrl,
    }));
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function uploadFlyer(file: File): Promise<string | null> {
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/submit/upload-image", { method: "POST", body: fd });
      if (!res.ok) return null;
      const { url } = await res.json();
      return url ?? null;
    } catch {
      return null;
    }
  }

  // ─── Import step handlers ──────────────────────────────────────────────────

  async function handleFlyerSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFlyerFile(file);
    setFlyerPreview(URL.createObjectURL(file));
    setExtractError(null);
    setExtracting(true);

    try {
      // Run extraction and image upload in parallel
      const fd = new FormData();
      fd.append("image", file);
      const [extractRes, blobUrl] = await Promise.all([
        fetch("/api/submit/extract", { method: "POST", body: fd }),
        uploadFlyer(file),
      ]);

      const data = await extractRes.json();
      if (!extractRes.ok) throw new Error(data.error ?? "Extraction failed");

      applyExtracted({ ...data, imageUrl: blobUrl ?? data.imageUrl ?? null });
      setStep("preview");
    } catch (err: any) {
      setExtractError(err.message ?? "Could not read flyer details");
    } finally {
      setExtracting(false);
    }
  }

  async function handleUrlImport() {
    if (!urlInput.trim()) return;
    setExtractError(null);
    setExtracting(true);

    try {
      const res = await fetch("/api/submit/extract-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput.trim() }),
      });
      const data = await res.json();

      if (data.unrecognized) {
        setUnknownSourceUrl(urlInput.trim());
        setForm((prev) => ({ ...prev, sourceUrl: urlInput.trim() }));
        setExtractError(
          `We can't auto-read ${data.domain} yet — fill in the details below and we'll note the source.`
        );
        setStep("details");
        return;
      }

      if (!res.ok) throw new Error(data.error ?? "Could not extract event from URL");

      applyExtracted(data);
      setStep("preview");
    } catch (err: any) {
      setExtractError(err.message ?? "Failed to import from URL");
    } finally {
      setExtracting(false);
    }
  }

  // ─── Image upload in details step ─────────────────────────────────────────

  async function handleImageFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const url = await uploadFlyer(file);
      if (url) setField("imageUrl", url);
    } finally {
      setUploading(false);
    }
  }

  // ─── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitResult(null);
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
          category: form.category || undefined,
          imageUrl: form.imageUrl || undefined,
          unknownSourceUrl: unknownSourceUrl || undefined,
          fromFeature: fromFeature || undefined,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setSubmitResult({ type: "error", message: data.error ?? "Submission failed" });
      } else if (data.duplicate) {
        setSubmitResult({
          type: "duplicate",
          message: "This event is already in the system.",
          eventId: data.eventId,
        });
      } else {
        setSubmitResult({
          type: "success",
          message: "Submitted for review — it'll appear on the calendar once approved.",
          eventId: data.eventId,
        });
        setStep("success");
      }
    } catch (err: any) {
      setSubmitResult({ type: "error", message: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setStep("import");
    setForm(EMPTY);
    setCameFromDetails(false);
    setUrlInput("");
    setFlyerFile(null);
    setFlyerPreview(null);
    setExtractError(null);
    setUnknownSourceUrl(null);
    setImageFile(null);
    setImagePreview(null);
    setSubmitResult(null);
    if (flyerRef.current) flyerRef.current.value = "";
    if (imageRef.current) imageRef.current.value = "";
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (step === "success") {
    return <SuccessView onReset={reset} />;
  }

  if (step === "import") {
    return (
      <ImportStep
        urlInput={urlInput}
        setUrlInput={setUrlInput}
        extracting={extracting}
        extractError={extractError}
        flyerPreview={flyerPreview}
        flyerRef={flyerRef}
        onFlyerSelect={handleFlyerSelect}
        onUrlImport={handleUrlImport}
        onManual={() => setStep("details")}
        setExtractError={setExtractError}
      />
    );
  }

  if (step === "preview") {
    return (
      <PreviewStep
        form={form}
        submitting={submitting}
        submitResult={submitResult}
        onSubmit={handleSubmit}
        onEditMore={() => setStep("details")}
        onBack={() => (cameFromDetails ? setStep("details") : setStep("import"))}
      />
    );
  }

  // details step
  return (
    <DetailsStep
      form={form}
      setField={setField}
      imageTab={imageTab}
      setImageTab={setImageTab}
      imageFile={imageFile}
      imagePreview={imagePreview}
      uploading={uploading}
      imageRef={imageRef}
      onImageFileSelect={handleImageFileSelect}
      onGoToPreview={() => { setCameFromDetails(true); setStep("preview"); }}
      onBack={() => (flyerFile || urlInput || cameFromDetails ? setStep("preview") : setStep("import"))}
      fromPreview={!!(flyerFile || urlInput || cameFromDetails)}
    />
  );
}

// ─── Import Step ──────────────────────────────────────────────────────────────

function ImportStep({
  urlInput,
  setUrlInput,
  extracting,
  extractError,
  flyerPreview,
  flyerRef,
  onFlyerSelect,
  onUrlImport,
  onManual,
  setExtractError,
}: {
  urlInput: string;
  setUrlInput: (v: string) => void;
  extracting: boolean;
  extractError: string | null;
  flyerPreview: string | null;
  flyerRef: React.RefObject<HTMLInputElement | null>;
  onFlyerSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onUrlImport: () => void;
  onManual: () => void;
  setExtractError: (v: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-8">
      {/* Flyer upload */}
      <div className="flex flex-col gap-3">
        <label className="font-body text-xs text-on-surface-variant uppercase tracking-widest">
          Upload a flyer
        </label>
        <div
          onClick={() => flyerRef.current?.click()}
          className={`relative rounded-2xl cursor-pointer transition-colors overflow-hidden border-2 border-dashed ${
            flyerPreview
              ? "border-on-surface-variant/30"
              : "border-on-surface-variant/20 hover:border-on-surface-variant/40 bg-surface-container-low"
          }`}
        >
          {extracting && flyerPreview ? (
            <div className="relative">
              <img
                src={flyerPreview}
                alt="Flyer preview"
                className="w-full max-h-64 object-contain rounded-2xl opacity-40"
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <Loader size={22} className="animate-spin text-on-surface-variant" />
                <span className="font-body text-xs text-on-surface-variant">Reading flyer...</span>
              </div>
            </div>
          ) : flyerPreview ? (
            <img
              src={flyerPreview}
              alt="Flyer preview"
              className="w-full max-h-64 object-contain rounded-2xl"
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 py-10 px-6">
              <div className="w-11 h-11 rounded-full bg-surface-container-high flex items-center justify-center">
                <Upload size={18} className="text-on-surface-variant" />
              </div>
              <p className="font-body text-sm text-on-surface text-center">
                Drag or click to upload a flyer
                <br />
                <span className="text-xs text-on-surface-variant opacity-70">
                  JPG, PNG, WEBP — we'll read the details automatically
                </span>
              </p>
            </div>
          )}
          <input
            ref={flyerRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onFlyerSelect}
            disabled={extracting}
          />
        </div>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-4">
        <div className="flex-1 h-px bg-on-surface/10" />
        <span className="font-body text-xs text-on-surface-variant uppercase tracking-widest">or</span>
        <div className="flex-1 h-px bg-on-surface/10" />
      </div>

      {/* URL import */}
      <div className="flex flex-col gap-3">
        <label className="font-body text-xs text-on-surface-variant uppercase tracking-widest">
          Paste an event link
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
            <input
              type="url"
              value={urlInput}
              onChange={(e) => { setUrlInput(e.target.value); setExtractError(null); }}
              onKeyDown={(e) => e.key === "Enter" && onUrlImport()}
              placeholder="Partiful, RA, Luma, Eventbrite..."
              disabled={extracting}
              className="w-full bg-surface-container-low text-on-surface text-sm pl-9 pr-4 py-2.5 rounded-xl outline-none focus:bg-surface-container placeholder:text-on-surface-variant font-body transition-colors"
            />
          </div>
          <button
            type="button"
            onClick={onUrlImport}
            disabled={!urlInput.trim() || extracting}
            className="flex items-center gap-2 font-body text-sm font-semibold px-4 py-2.5 rounded-xl bg-surface-container text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-40 shrink-0"
          >
            {extracting ? <Loader size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {extracting ? "Importing..." : "Import"}
          </button>
        </div>
        {extractError && (
          <div className="flex items-start gap-2 font-body text-xs text-[#f59e0b]">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            <span>{extractError}</span>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="flex items-center gap-4">
        <div className="flex-1 h-px bg-on-surface/10" />
        <span className="font-body text-xs text-on-surface-variant uppercase tracking-widest">or</span>
        <div className="flex-1 h-px bg-on-surface/10" />
      </div>

      {/* Manual entry */}
      <button
        type="button"
        onClick={onManual}
        className="font-body text-sm text-on-surface-variant hover:text-on-surface transition-colors self-start flex items-center gap-2"
      >
        <Pencil size={14} />
        Enter details manually
      </button>
    </div>
  );
}

// ─── Preview Step ─────────────────────────────────────────────────────────────

function PreviewStep({
  form,
  submitting,
  submitResult,
  onSubmit,
  onEditMore,
  onBack,
}: {
  form: FormState;
  submitting: boolean;
  submitResult: { type: "success" | "duplicate" | "error"; message: string } | null;
  onSubmit: () => void;
  onEditMore: () => void;
  onBack: () => void;
}) {
  const dateDisplay = formatDateForDisplay(form.dateRaw);
  const timeDisplay = formatTimeForDisplay(form.timeRaw);
  const tags = form.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 font-body text-sm text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <ArrowLeft size={15} />
          Back
        </button>
        <span className="font-body text-xs text-on-surface-variant uppercase tracking-widest">
          Preview
        </span>
        <div className="w-16" />
      </div>

      {/* Event card — mirrors the real listing */}
      <div className="bg-surface-container-low rounded-2xl overflow-hidden flex flex-col">
        {form.imageUrl && (
          <img
            src={form.imageUrl}
            alt="Event"
            className="w-full max-h-72 object-cover"
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
          />
        )}

        <div className="p-5 flex flex-col gap-4">
          {/* Title */}
          <h2 className="font-display text-2xl font-bold text-on-surface leading-tight">
            {form.title || <span className="text-on-surface-variant italic">Untitled Event</span>}
          </h2>

          {/* Date / time */}
          <div className="flex flex-col gap-1.5">
            {dateDisplay ? (
              <div className="flex items-center gap-2 font-body text-sm text-on-surface-variant">
                <Calendar size={14} className="shrink-0" />
                {dateDisplay}
              </div>
            ) : (
              <div className="flex items-center gap-2 font-body text-sm text-on-surface-variant/50 italic">
                <Calendar size={14} className="shrink-0" />
                No date set
              </div>
            )}
            {timeDisplay && (
              <div className="flex items-center gap-2 font-body text-sm text-on-surface-variant">
                <Clock size={14} className="shrink-0" />
                {timeDisplay}
              </div>
            )}
          </div>

          {/* Venue */}
          {(form.venueName || form.venueAddress) && (
            <div className="flex items-start gap-2 font-body text-sm text-on-surface-variant">
              <MapPin size={14} className="shrink-0 mt-0.5" />
              <span>
                {form.venueName}
                {form.venueName && form.venueAddress && " · "}
                {form.venueAddress}
              </span>
            </div>
          )}

          {/* Price */}
          {(form.price || form.isFree) && (
            <span className="font-body text-sm font-semibold text-on-surface">
              {form.isFree ? "Free" : form.price}
            </span>
          )}

          {/* Description */}
          {form.description && (
            <p className="font-body text-sm text-on-surface-variant leading-relaxed">
              {form.description}
            </p>
          )}

          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="font-body text-xs bg-surface-container px-2.5 py-1 rounded-full text-on-surface-variant"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Result message */}
      {submitResult && submitResult.type !== "success" && (
        <div
          className={`flex items-start gap-3 p-4 rounded-xl font-body text-sm ${
            submitResult.type === "duplicate"
              ? "bg-[#f59e0b]/10 text-[#f59e0b]"
              : "bg-[#ef4444]/10 text-[#ef4444]"
          }`}
        >
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          {submitResult.message}
        </div>
      )}

      {/* CTAs */}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onSubmit}
          disabled={!form.title || !form.dateRaw || submitting}
          className="flex items-center justify-center gap-2 font-body text-sm font-semibold px-6 py-3 rounded-full bg-on-surface text-surface hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {submitting ? (
            <>
              <Loader size={14} className="animate-spin" />
              Submitting...
            </>
          ) : (
            <>
              Submit for Review
              <ArrowRight size={15} />
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onEditMore}
          className="font-body text-sm text-on-surface-variant hover:text-on-surface transition-colors text-center"
        >
          Edit details
        </button>
      </div>
    </div>
  );
}

// ─── Details Step ─────────────────────────────────────────────────────────────

function DetailsStep({
  form,
  setField,
  imageTab,
  setImageTab,
  imageFile,
  imagePreview,
  uploading,
  imageRef,
  onImageFileSelect,
  onGoToPreview,
  onBack,
  fromPreview,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  imageTab: "upload" | "url";
  setImageTab: (t: "upload" | "url") => void;
  imageFile: File | null;
  imagePreview: string | null;
  uploading: boolean;
  imageRef: React.RefObject<HTMLInputElement | null>;
  onImageFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onGoToPreview: () => void;
  onBack: () => void;
  fromPreview: boolean;
}) {
  // Current image to display (local preview > existing URL)
  const displayImage = imagePreview ?? (form.imageUrl || null);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 font-body text-sm text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <ArrowLeft size={15} />
          {fromPreview ? "Back to preview" : "Back"}
        </button>
        <span className="font-body text-xs text-on-surface-variant uppercase tracking-widest">
          Details
        </span>
        <div className="w-24" />
      </div>

      <div className="flex flex-col gap-4">
        {/* Core fields */}
        <Field label="Event Title" required>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setField("title", e.target.value)}
            placeholder="e.g. Honey Soundsystem at Public Works"
            required
            className="input-field"
          />
        </Field>

        <Field label="Category">
          <select
            value={form.category}
            onChange={(e) => setField("category", e.target.value)}
            className="input-field"
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Date" required>
            <input
              type="date"
              value={form.dateRaw}
              onChange={(e) => setField("dateRaw", e.target.value)}
              required
              className="input-field"
            />
          </Field>
          <Field label="Time">
            <input
              type="time"
              value={form.timeRaw}
              onChange={(e) => setField("timeRaw", e.target.value)}
              className="input-field"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Venue Name">
            <input
              type="text"
              value={form.venueName}
              onChange={(e) => setField("venueName", e.target.value)}
              placeholder="e.g. Public Works"
              className="input-field"
            />
          </Field>
          <Field label="Address">
            <input
              type="text"
              value={form.venueAddress}
              onChange={(e) => setField("venueAddress", e.target.value)}
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
              onChange={(e) => setField("price", e.target.value)}
              placeholder="e.g. $15, Free, PWYW"
              className="input-field"
            />
          </Field>
          <Field label="">
            <label className="flex items-center gap-2 cursor-pointer mt-5">
              <input
                type="checkbox"
                checked={form.isFree}
                onChange={(e) => setField("isFree", e.target.checked)}
                className="accent-[#a855f7]"
              />
              <span className="font-body text-sm text-on-surface">Free event</span>
            </label>
          </Field>
        </div>

        <Field label="Description">
          <textarea
            value={form.description}
            onChange={(e) => setField("description", e.target.value)}
            placeholder="What's the vibe? Who's playing?"
            rows={3}
            className="input-field resize-none"
          />
        </Field>

        <Field label="Tags">
          <input
            type="text"
            value={form.tags}
            onChange={(e) => setField("tags", e.target.value)}
            placeholder="e.g. electronic, rave, warehouse (comma-separated)"
            className="input-field"
          />
        </Field>

        <Field label="Source URL">
          <p className="font-body text-xs text-on-surface-variant mb-1.5">
            Adding a link helps other users find more info and lets us verify the event.
          </p>
          <input
            type="url"
            value={form.sourceUrl}
            onChange={(e) => setField("sourceUrl", e.target.value)}
            placeholder="Instagram post, event page, etc."
            className="input-field ring-1 ring-primary/40 focus:ring-primary"
          />
        </Field>

        {/* Image section */}
        <Field label="Event Image">
          <div className="flex flex-col gap-3">
            {/* Tabs */}
            <div className="flex gap-1 bg-surface-container-low p-1 rounded-full w-fit">
              {(["upload", "url"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setImageTab(t)}
                  className={`font-body text-xs font-semibold uppercase tracking-widest px-4 py-1.5 rounded-full transition-colors ${
                    imageTab === t
                      ? "bg-surface-container text-on-surface"
                      : "text-on-surface-variant hover:text-on-surface"
                  }`}
                >
                  {t === "upload" ? "Upload" : "Paste URL"}
                </button>
              ))}
            </div>

            {imageTab === "upload" ? (
              <div
                onClick={() => imageRef.current?.click()}
                className="relative border-2 border-dashed border-on-surface-variant/20 hover:border-on-surface-variant/40 rounded-xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                {uploading ? (
                  <div className="flex items-center gap-2 py-2 text-on-surface-variant">
                    <Loader size={16} className="animate-spin" />
                    <span className="font-body text-sm">Uploading...</span>
                  </div>
                ) : displayImage && imageFile ? (
                  <img
                    src={displayImage}
                    alt="Preview"
                    className="max-h-48 rounded-lg object-contain"
                  />
                ) : (
                  <>
                    <ImageIcon size={20} className="text-on-surface-variant" />
                    <span className="font-body text-xs text-on-surface-variant text-center">
                      Click to upload an image
                    </span>
                  </>
                )}
                <input
                  ref={imageRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onImageFileSelect}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <input
                  type="url"
                  value={form.imageUrl}
                  onChange={(e) => setField("imageUrl", e.target.value)}
                  placeholder="https://..."
                  className="input-field"
                />
                {form.imageUrl && !imageFile && (
                  <img
                    src={form.imageUrl}
                    alt="Preview"
                    className="max-h-48 rounded-xl object-contain"
                    onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                  />
                )}
              </div>
            )}
          </div>
        </Field>

        <Field label="Note (optional)">
          <input
            type="text"
            value={form.submitterNote}
            onChange={(e) => setField("submitterNote", e.target.value)}
            placeholder="Anything the reviewer should know?"
            className="input-field"
          />
        </Field>
      </div>

      <button
        type="button"
        onClick={onGoToPreview}
        disabled={!form.title || !form.dateRaw || uploading}
        className="font-body text-sm font-semibold px-6 py-3 rounded-full bg-on-surface text-surface hover:opacity-90 transition-opacity disabled:opacity-40 self-start flex items-center gap-2"
      >
        Preview Event
        <ArrowRight size={15} />
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
    </div>
  );
}

// ─── Success View ─────────────────────────────────────────────────────────────

function SuccessView({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <div className="flex items-start gap-3 p-4 rounded-2xl bg-[#4ade80]/10 text-[#4ade80] w-full">
        <CheckCircle size={18} className="shrink-0 mt-0.5" />
        <div className="flex flex-col gap-0.5">
          <span className="font-body text-sm font-semibold">Submitted for review</span>
          <span className="font-body text-sm opacity-80">
            It'll appear on the calendar once approved.
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onReset}
        className="font-body text-sm text-on-surface-variant hover:text-on-surface transition-colors"
      >
        Submit another event
      </button>
    </div>
  );
}

// ─── Shared Field wrapper ─────────────────────────────────────────────────────

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
