import { NextRequest, NextResponse } from "next/server";
import { extractEventFromImage, extractEventFromCaption } from "@/lib/extract";

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const imageFile = formData.get("image") as File | null;
      const caption = (formData.get("caption") as string | null) ?? undefined;

      if (!imageFile && !caption) {
        return NextResponse.json(
          { error: "Provide an image file or caption text" },
          { status: 400 }
        );
      }

      if (imageFile) {
        const buffer = await imageFile.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");
        const mediaType = imageFile.type || "image/jpeg";
        const extracted = await extractEventFromImage(base64, mediaType, caption);
        return NextResponse.json(extracted);
      }

      // Caption-only path (Instagram URL with pasted caption)
      const extracted = await extractEventFromCaption(caption!);
      return NextResponse.json(extracted);
    }

    // JSON body with instagramUrl + caption
    const body = await req.json();
    const { caption, instagramUrl } = body;

    if (!caption) {
      return NextResponse.json(
        { error: "Provide a caption or upload an image" },
        { status: 400 }
      );
    }

    const extracted = await extractEventFromCaption(caption);
    return NextResponse.json({ ...extracted, sourceUrl: instagramUrl ?? null });
  } catch (err: any) {
    console.error("[submit/extract]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
