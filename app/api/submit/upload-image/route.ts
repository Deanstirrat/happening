import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { randomUUID } from "crypto";
import { clientIp, rateLimit } from "@/lib/rateLimit";

// 8 MB hard cap on uploaded flyers.
const MAX_BYTES = 8 * 1024 * 1024;
// Per-IP: 10 uploads per 10 minutes.
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 10 * 60 * 1000;

// MIME allowlist → server-chosen extension. The client filename is never trusted.
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Sniff magic bytes so a renamed/forged Content-Type can't smuggle non-image data. */
function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    // "GIF87a" / "GIF89a"
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    // "RIFF"...."WEBP"
    return "image/webp";
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json({ error: "Image upload not configured" }, { status: 503 });
    }

    const limit = rateLimit(`upload-image:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!limit.ok) {
      return NextResponse.json(
        { error: "Too many uploads. Please try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
      );
    }

    const formData = await req.formData();
    const file = formData.get("image") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    if (file.size === 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `Image too large (max ${MAX_BYTES / (1024 * 1024)} MB)` },
        { status: 413 }
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    // Trust the sniffed type, not the client-declared MIME or filename.
    const sniffed = sniffMime(bytes);
    if (!sniffed || !ALLOWED[sniffed]) {
      return NextResponse.json(
        { error: "Unsupported image type. Use JPEG, PNG, GIF, or WebP." },
        { status: 415 }
      );
    }

    const ext = ALLOWED[sniffed];
    const blob = await put(`event-flyers/${randomUUID()}.${ext}`, bytes, {
      access: "public",
      contentType: sniffed,
    });

    return NextResponse.json({ url: blob.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    console.error("[submit/upload-image]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
