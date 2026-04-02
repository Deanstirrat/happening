"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

export default function SubmissionImageEdit({
  id,
  imageUrl,
  secret,
}: {
  id: string;
  imageUrl: string | null;
  secret: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(imageUrl ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await fetch(`/api/admin/events/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-scrape-secret": secret,
      },
      body: JSON.stringify({ imageUrl: value || null }),
    });
    setSaving(false);
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2">
        {value && (
          <div className="relative w-full h-40 rounded-xl overflow-hidden bg-surface-container-high">
            <Image
              src={`/api/image-proxy?url=${encodeURIComponent(value)}`}
              alt="Preview"
              fill
              className="object-cover"
              unoptimized
            />
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="url"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="https://…"
            autoFocus
            className="flex-1 font-body text-xs text-on-surface bg-surface-container-high rounded-xl px-3 py-2 border border-transparent focus:border-on-surface-variant focus:outline-none transition-colors"
          />
          <button
            onClick={save}
            disabled={saving}
            className="font-body text-xs font-semibold px-3 py-2 rounded-xl bg-on-surface text-surface hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0"
          >
            {saving ? "…" : "Save"}
          </button>
          <button
            onClick={() => { setEditing(false); setValue(imageUrl ?? ""); }}
            disabled={saving}
            className="font-body text-xs px-3 py-2 rounded-xl bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-50 shrink-0"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (imageUrl) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="relative w-full h-40 rounded-xl overflow-hidden bg-surface-container-high group"
      >
        <Image
          src={`/api/image-proxy?url=${encodeURIComponent(imageUrl)}`}
          alt="Event image"
          fill
          className="object-cover"
          unoptimized
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
          <span className="font-body text-xs font-semibold text-white opacity-0 group-hover:opacity-100 transition-opacity">
            edit image
          </span>
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="w-full h-14 rounded-xl bg-surface-container-high border border-dashed border-outline-variant text-on-surface-variant font-body text-xs hover:text-on-surface hover:border-outline transition-colors"
    >
      + add image
    </button>
  );
}
