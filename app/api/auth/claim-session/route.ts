import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

/**
 * Migrate an anonymous browser session's data into the signed-in account
 * (issue #96). Called by the client right after a magic-link login, passing the
 * `happeningSessionId` held in localStorage.
 *
 * Today this claims the session's "I'm interested" votes by stamping `userId`
 * onto the matching EventInterest rows. Idempotent: only un-claimed rows
 * (userId null) are updated, so repeat calls are no-ops.
 *
 * Body: { sessionId: string }
 * Returns: { ok, claimed } where `claimed` is the number of votes migrated.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const sessionId: unknown = body?.sessionId;
  if (typeof sessionId !== "string" || !sessionId) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { count } = await prisma.eventInterest.updateMany({
    where: { sessionId, userId: null },
    data: { userId: user.id },
  });

  return NextResponse.json({ ok: true, claimed: count });
}
