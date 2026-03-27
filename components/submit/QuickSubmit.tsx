"use client";

import { useState, useRef } from "react";
import { Camera, Loader, CheckCircle, AlertCircle } from "lucide-react";

type State = "idle" | "submitting" | "success" | "duplicate" | "error";

export default function QuickSubmit() {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [state, setState] = useState<State>("idle");
  const [resultMessage, setResultMessage] = useState("");
  const [resultTitle, setResultTitle] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setState("idle");
    setResultMessage("");
  }

  function reset() {
    setImageFile(null);
    setImagePreview(null);
    setNote("");
    setState("idle");
    setResultMessage("");
    setResultTitle("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!imageFile) return;

    setState("submitting");
    try {
      const fd = new FormData();
      fd.append("image", imageFile);
      if (note.trim()) fd.append("note", note.trim());

      const res = await fetch("/api/submit/quick", { method: "POST", body: fd });
      const data = await res.json();

      if (!res.ok) {
        setState("error");
        setResultMessage(data.error ?? "Something went wrong. Try the full form below.");
      } else if (data.duplicate) {
        setState("duplicate");
        setResultMessage("This event is already in the system.");
      } else {
        setState("success");
        setResultTitle(data.title ?? "");
      }
    } catch {
      setState("error");
      setResultMessage("Something went wrong. Try the full form below.");
    }
  }

  if (state === "success") {
    return (
      <div className="flex flex-col items-start gap-4">
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-[#4ade80]/10 text-[#4ade80] w-full">
          <CheckCircle size={18} className="shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span className="font-body text-sm font-semibold">Submitted for review</span>
            {resultTitle && (
              <span className="font-body text-sm opacity-80">{resultTitle}</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={reset}
          className="font-body text-sm text-on-surface-variant hover:text-on-surface transition-colors"
        >
          Submit another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* Upload area */}
      <div
        onClick={() => fileRef.current?.click()}
        className={`relative rounded-2xl cursor-pointer transition-colors overflow-hidden ${
          imagePreview
            ? "bg-surface-container-low"
            : "bg-surface-container-low hover:bg-surface-container"
        }`}
      >
        {imagePreview ? (
          <img
            src={imagePreview}
            alt="Flyer preview"
            className="w-full max-h-80 object-contain rounded-2xl"
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-12 px-6">
            <div className="w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center">
              <Camera size={22} className="text-on-surface-variant" />
            </div>
            <div className="text-center">
              <p className="font-body text-sm text-on-surface">
                Snap a photo of a flyer
              </p>
              <p className="font-body text-xs text-on-surface-variant mt-0.5">
                We'll read the details and add it to the calendar
              </p>
            </div>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleImageChange}
        />
      </div>

      {/* Note field — only shown after image selected */}
      {imagePreview && (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything to add? (optional)"
          rows={2}
          className="w-full bg-surface-container-low text-on-surface text-sm px-4 py-2.5 rounded-xl outline-none focus:bg-surface-container placeholder:text-on-surface-variant font-body transition-colors resize-none"
        />
      )}

      {/* Error / duplicate feedback */}
      {(state === "error" || state === "duplicate") && (
        <div
          className={`flex items-start gap-2.5 p-3.5 rounded-xl font-body text-sm ${
            state === "duplicate"
              ? "bg-[#f59e0b]/10 text-[#f59e0b]"
              : "bg-[#ef4444]/10 text-[#ef4444]"
          }`}
        >
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          <span>
            {resultMessage}
            {state === "error" && (
              <>
                {" "}
                <a href="#full-form" className="underline">
                  Try the full form
                </a>
                .
              </>
            )}
          </span>
        </div>
      )}

      {/* Submit button */}
      <button
        type="submit"
        disabled={!imageFile || state === "submitting"}
        className="font-body text-sm font-semibold px-6 py-3 rounded-full bg-on-surface text-surface hover:opacity-90 transition-opacity disabled:opacity-40 self-start flex items-center gap-2"
      >
        {state === "submitting" ? (
          <>
            <Loader size={14} className="animate-spin" />
            Reading your flyer...
          </>
        ) : (
          "Submit Flyer"
        )}
      </button>
    </form>
  );
}
