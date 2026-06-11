export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import AdminNav from "../_components/AdminNav";

export default async function AdminAuditPage() {
  if (!(await getAdminUser())) redirect("/login");

  const logs = await prisma.adminAuditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { user: { select: { email: true, name: true } } },
  });

  return (
    <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <AdminNav current="audit" />

      <div className="mt-8">
        <h1 className="font-headline font-black text-2xl text-on-surface lowercase mb-1">
          audit log
        </h1>
        <p className="font-body text-xs text-on-surface-variant mb-8">
          The 200 most recent admin actions. Who did what, and when.
        </p>

        {logs.length === 0 ? (
          <p className="font-body text-sm text-on-surface-variant">No actions recorded yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {logs.map((log) => (
              <div
                key={log.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-surface-container rounded-xl px-4 py-3"
              >
                <span className="font-mono text-xs text-on-surface font-semibold">
                  {log.action}
                </span>
                <span className="font-body text-xs text-on-surface-variant">
                  {log.actorEmail}
                </span>
                {log.targetType && (
                  <span className="font-body text-[11px] text-on-surface-variant">
                    {log.targetType}
                    {log.targetId ? `:${log.targetId}` : ""}
                  </span>
                )}
                <span className="font-body text-[11px] text-on-surface-variant ml-auto">
                  {format(new Date(log.createdAt), "MMM d, yyyy · h:mm a")}
                </span>
                {log.metadata != null && (
                  <pre className="basis-full font-mono text-[10px] text-on-surface-variant whitespace-pre-wrap break-all mt-1">
                    {JSON.stringify(log.metadata)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
