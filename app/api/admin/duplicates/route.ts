import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/adminAuth";
import { mergeEventCluster, pairKey } from "@/lib/merge/executeMerge";

/**
 * Admin dedup review actions (issue #102).
 *   action: "merge"   — merge a candidate pair into one survivor (lib/merge).
 *   action: "dismiss" — record a "not a duplicate" so the pair stops resurfacing.
 */
export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { action, aId, bId } = body as { action?: string; aId?: string; bId?: string };

  if (!aId || !bId || aId === bId) {
    return NextResponse.json({ error: "aId and bId are required" }, { status: 400 });
  }

  if (action === "merge") {
    try {
      const result = await mergeEventCluster([aId, bId]);
      return NextResponse.json({ ok: true, ...result });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 409 });
    }
  }

  if (action === "dismiss") {
    const key = pairKey(aId, bId);
    await prisma.duplicatePairDismissal.upsert({
      where: { pairKey: key },
      update: {},
      create: { pairKey: key },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
