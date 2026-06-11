import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// One-click unsubscribe from the weekly digest (issue #97). The token in the
// email footer is the capability — no login required, since most readers won't
// be signed in when they click. The same link offers a one-tap resubscribe so an
// accidental click is recoverable.
//
// Unknown/blank tokens get the same friendly confirmation as a real unsubscribe:
// the goal is "you won't be emailed", and we don't want to leak which tokens are
// valid by varying the response.

function page(title: string, body: string, actionUrl?: string, actionLabel?: string): NextResponse {
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? "https://happeningsf.now").replace(/\/$/, "");
  const action = actionUrl
    ? `<p style="margin:20px 0 0"><a href="${actionUrl}" style="display:inline-block;background:#000;color:#fff;font-weight:700;font-size:14px;padding:10px 20px;border-radius:6px;text-decoration:none">${actionLabel}</a></p>`
    : "";
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · happening</title></head>
    <body style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:48px 24px;color:#111">
      <h2 style="font-size:24px;font-weight:900;margin:0 0 4px">happening</h2>
      <p style="color:#888;font-size:13px;margin:0 0 32px">SF Bay Area Events</p>
      <h3 style="font-size:18px;margin:0 0 8px">${title}</h3>
      <p style="font-size:15px;line-height:1.5;color:#333;margin:0">${body}</p>
      ${action}
      <p style="margin:32px 0 0"><a href="${base}" style="color:#888;font-size:13px">← Back to happening</a></p>
    </body></html>`;
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function GET(req: NextRequest) {
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? "https://happeningsf.now").replace(/\/$/, "");
  const token = req.nextUrl.searchParams.get("token");
  const resubscribe = req.nextUrl.searchParams.get("action") === "resubscribe";

  const user = token ? await prisma.user.findUnique({ where: { unsubscribeToken: token } }) : null;

  if (!user) {
    return page("You're unsubscribed", "You won't receive the weekly digest. If you keep getting it, the link may have expired — manage email from your account.");
  }

  if (resubscribe) {
    await prisma.user.update({ where: { id: user.id }, data: { digestOptIn: true } });
    return page("You're back in", "You'll get the weekly “this weekend in SF” digest again.", `${base}/api/unsubscribe?token=${token}`, "Unsubscribe");
  }

  await prisma.user.update({ where: { id: user.id }, data: { digestOptIn: false } });
  return page(
    "You're unsubscribed",
    "You won't receive the weekly “this weekend in SF” digest anymore. Changed your mind?",
    `${base}/api/unsubscribe?token=${token}&action=resubscribe`,
    "Resubscribe"
  );
}

// RFC 8058 one-click unsubscribe. Gmail/Yahoo POST here (body
// `List-Unsubscribe=One-Click`) straight from the inbox UI, so this must opt the
// reader out with no confirmation step and return 200 regardless. Unknown tokens
// still succeed silently — we never reveal which tokens are valid.
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (token) {
    await prisma.user.updateMany({ where: { unsubscribeToken: token }, data: { digestOptIn: false } });
  }
  return new NextResponse(null, { status: 200 });
}
