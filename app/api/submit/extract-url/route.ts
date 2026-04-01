import { NextRequest, NextResponse } from "next/server";
import { extractFromUrl } from "@/lib/extractFromUrl";

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url?.trim()) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    const result = await extractFromUrl(url.trim());

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    if ("unrecognized" in result) {
      return NextResponse.json({ unrecognized: true, domain: result.domain });
    }

    return NextResponse.json({
      ...result.data.extracted,
      imageUrl: result.data.imageUrl,
      sourceUrl: result.data.sourceUrl,
    });
  } catch (err: any) {
    console.error("[submit/extract-url]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
