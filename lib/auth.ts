import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Resend } from "resend";

const SESSION_COOKIE = "editor_session";
const SESSION_DURATION_DAYS = 30;
const MAGIC_LINK_EXPIRY_MINUTES = 15;

// ── Session ──────────────────────────────────────────────────────────────────

export async function createSession(email: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error("User not found");

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS);

  const session = await prisma.userSession.create({
    data: { userId: user.id, expiresAt },
  });
  return session.token;
}

export async function getSessionUser(req?: NextRequest) {
  let token: string | undefined;

  if (req) {
    token = req.cookies.get(SESSION_COOKIE)?.value;
  } else {
    const jar = await cookies();
    token = jar.get(SESSION_COOKIE)?.value;
  }

  if (!token) return null;

  const session = await prisma.userSession.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

export async function deleteSession(token: string) {
  await prisma.userSession.deleteMany({ where: { token } });
}

export function sessionCookieOptions(token: string) {
  const expires = new Date();
  expires.setDate(expires.getDate() + SESSION_DURATION_DAYS);
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

export function clearSessionCookie() {
  return {
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
}

export function getSessionTokenFromRequest(req: NextRequest) {
  return req.cookies.get(SESSION_COOKIE)?.value;
}

// ── Magic links ───────────────────────────────────────────────────────────────

export async function createMagicLinkToken(email: string): Promise<string> {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + MAGIC_LINK_EXPIRY_MINUTES);

  const record = await prisma.magicLinkToken.create({
    data: { email, expiresAt },
  });
  return record.token;
}

export async function verifyMagicLinkToken(token: string): Promise<string | null> {
  const record = await prisma.magicLinkToken.findUnique({ where: { token } });

  if (!record || record.used || record.expiresAt < new Date()) return null;

  await prisma.magicLinkToken.update({ where: { token }, data: { used: true } });
  return record.email;
}

// ── Email ────────────────────────────────────────────────────────────────────

export async function sendMagicLinkEmail(email: string, token: string) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://happening.so";
  const link = `${baseUrl}/api/auth/verify?token=${token}`;
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "happening <noreply@happening.so>";

  const resend = new Resend(process.env.RESEND_API_KEY);

  await resend.emails.send({
    from: fromEmail,
    to: email,
    subject: "Your login link for happening",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <h2 style="font-size:24px;font-weight:900;margin:0 0 8px">happening</h2>
        <p style="color:#888;font-size:13px;margin:0 0 32px">SF Bay Area Events</p>
        <p style="font-size:15px;margin:0 0 24px">Click the link below to sign in. This link expires in ${MAGIC_LINK_EXPIRY_MINUTES} minutes.</p>
        <a href="${link}" style="display:inline-block;background:#fff;color:#000;font-weight:700;font-size:14px;padding:12px 24px;border-radius:6px;text-decoration:none">Sign in to happening</a>
        <p style="font-size:12px;color:#888;margin:32px 0 0">If you didn't request this, you can safely ignore it.</p>
      </div>
    `,
  });
}
