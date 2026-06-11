import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createMagicLinkToken, sendMagicLinkEmail } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rateLimit";

// Minimal sanity check so we don't mint tokens / send mail for obvious garbage.
// Signup is open to any address (issue #96), so we don't gate on an existing
// account — the account is created when the link is redeemed.
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// Throttle window and caps. Magic links expire in 15 min, so a 15-min window
// keeps a single inbox/IP from being flooded while still allowing a couple of
// retries (e.g. typo'd then corrected, or the first email went to spam).
const WINDOW_MS = 15 * 60 * 1000;
const PER_IP_LIMIT = 5;
const PER_EMAIL_LIMIT = 3;

export async function POST(req: NextRequest) {
  const { email } = await req.json().catch(() => ({}));

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const normalized = email.trim().toLowerCase();

  // Always return 200 so a caller can't probe which addresses get throttled or
  // already have accounts. Bail quietly on malformed input or when throttled.
  if (!looksLikeEmail(normalized)) {
    return NextResponse.json({ ok: true });
  }

  // Per-IP throttle (in-memory, best-effort).
  if (!rateLimit(`magic-link:ip:${clientIp(req)}`, PER_IP_LIMIT, WINDOW_MS).ok) {
    return NextResponse.json({ ok: true });
  }

  // Per-email throttle, durable across restarts and instances: count how many
  // links this address already requested in the window. Each send writes a
  // MagicLinkToken row, so the row count is the request count.
  const since = new Date(Date.now() - WINDOW_MS);
  const recent = await prisma.magicLinkToken.count({
    where: { email: normalized, createdAt: { gte: since } },
  });

  // Signup is open (issue #96): send the link regardless of whether an account
  // exists yet. The account is created with role USER when the link is redeemed.
  if (recent < PER_EMAIL_LIMIT) {
    const token = await createMagicLinkToken(normalized);
    await sendMagicLinkEmail(normalized, token);
  }

  return NextResponse.json({ ok: true });
}
