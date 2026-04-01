import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

export async function POST(req: NextRequest) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json({ error: "Image upload not configured" }, { status: 503 });
    }

    const formData = await req.formData();
    const file = formData.get("image") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    const ext = file.name.split(".").pop() ?? "jpg";
    const blob = await put(`event-flyers/${Date.now()}.${ext}`, file, {
      access: "public",
    });

    return NextResponse.json({ url: blob.url });
  } catch (err: any) {
    console.error("[submit/upload-image]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
