import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { EventCategory, FollowTargetType } from "@prisma/client";

const TARGET_TYPES = new Set(Object.values(FollowTargetType));
const CATEGORIES = new Set<string>(Object.values(EventCategory));

/**
 * Normalize and validate a follow target. Returns the canonical targetId (the
 * key the row is stored under) or null if the target is invalid. Keeping this
 * here means the targetId written on follow matches what lib/follows reads back:
 *   VENUE    → must be an existing Venue id
 *   CATEGORY → must be an EventCategory enum value
 *   ARTIST   → lowercased, trimmed display name
 */
async function normalizeTarget(
  targetType: FollowTargetType,
  targetId: string
): Promise<string | null> {
  if (targetType === "CATEGORY") {
    return CATEGORIES.has(targetId) ? targetId : null;
  }
  if (targetType === "ARTIST") {
    const name = targetId.trim().toLowerCase();
    return name.length > 0 ? name : null;
  }
  // VENUE
  const venue = await prisma.venue.findUnique({ where: { id: targetId }, select: { id: true } });
  return venue ? venue.id : null;
}

/** List the signed-in user's follows. Returns { follows: [{ targetType, targetId }] }. */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const follows = await prisma.follow.findMany({
    where: { userId: user.id },
    select: { targetType: true, targetId: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ follows });
}

/**
 * Toggle a follow. Idempotent: the client sends its desired state and gets back
 * the authoritative state.
 *
 * Body: { targetType: "VENUE"|"CATEGORY"|"ARTIST", targetId: string, following: boolean }
 * Returns: { ok, following, targetType, targetId }
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const targetType: unknown = body?.targetType;
  const rawTargetId: unknown = body?.targetId;
  const following: unknown = body?.following;

  if (
    typeof targetType !== "string" ||
    !TARGET_TYPES.has(targetType as FollowTargetType) ||
    typeof rawTargetId !== "string" ||
    typeof following !== "boolean"
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const type = targetType as FollowTargetType;
  const targetId = await normalizeTarget(type, rawTargetId);
  if (!targetId) {
    return NextResponse.json({ error: "Unknown follow target" }, { status: 404 });
  }

  if (following) {
    await prisma.follow.upsert({
      where: { userId_targetType_targetId: { userId: user.id, targetType: type, targetId } },
      update: {},
      create: { userId: user.id, targetType: type, targetId },
    });
  } else {
    await prisma.follow.deleteMany({
      where: { userId: user.id, targetType: type, targetId },
    });
  }

  return NextResponse.json({ ok: true, following, targetType: type, targetId });
}
