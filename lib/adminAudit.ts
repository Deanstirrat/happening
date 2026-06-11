import { prisma } from "@/lib/prisma";

// Minimal shape of the acting admin (as returned by getAdminUser).
type Actor = { id: string; email: string };

interface AuditEntry {
  // Dotted verb describing the action, e.g. "event.approve", "user.delete".
  action: string;
  // What was acted on, e.g. "event", "user", "submission".
  targetType?: string;
  targetId?: string;
  // Any extra context worth keeping (old/new values, counts, reason, …).
  metadata?: Record<string, unknown>;
}

// Records an admin action for accountability (issue #78). Best-effort: a logging
// failure must never break the underlying admin action, so errors are swallowed
// after being surfaced to the server console.
export async function logAdminAction(actor: Actor, entry: AuditEntry) {
  try {
    await prisma.adminAuditLog.create({
      data: {
        userId: actor.id,
        actorEmail: actor.email,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        metadata: entry.metadata as object | undefined,
      },
    });
  } catch (err) {
    console.error("Failed to write admin audit log", { action: entry.action, err });
  }
}
