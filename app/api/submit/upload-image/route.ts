import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { randomBytes } from "crypto";
import { rateLimit, clientIp } from "@/lib/rateLimit";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const RATE_LIMIT = 12; // uploads per IP
const RATE_WINDOW_MS = 10 * 60 * 1000; // per 10 minutes

// Allowlisted image types, keyed by the extension we choose server-side. The
// client-supplied filename and Content-Type are never trusted — we sniff the
// magic bytes of the actual payload instead.
const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

const SIGNATURES: { ext: string; match: (b: Uint8Array) => boolean }[] = [
  { ext: "jpg", match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: "png",
    match: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    ext: "gif",
    match: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  },
  {
    ext: "webp",
    // "RIFF" .... "WEBP"
    match: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

function sniffExtension(bytes: Uint8Array): string | null {
  for (const sig of SIGNATURES) {
    if (sig.match(bytes)) return sig.ext;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json({ error: "Image upload not configured" }, { status: 503 });
    }

    if (!rateLimit(`upload-image:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS)) {
      return NextResponse.json({ error: "Too many uploads. Try again later." }, { status: 429 });
    }

    const formData = await req.formData();
    const file = formData.get("image") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Image exceeds 8 MB limit" }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = sniffExtension(buffer);
    if (!ext) {
      return NextResponse.json(
        { error: "Unsupported image type. Use JPEG, PNG, GIF, or WebP." },
        { status: 415 },
      );
    }

    // Random, server-chosen filename — never derived from client input.
    const name = `event-flyers/${randomBytes(16).toString("hex")}.${ext}`;
    const blob = await put(name, buffer, { access: "public", contentType: MIME[ext] });

    return NextResponse.json({ url: blob.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    console.error("[submit/upload-image]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
