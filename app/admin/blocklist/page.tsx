export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { format } from "date-fns";
import AdminNav from "../_components/AdminNav";
import UnblockButton from "./UnblockButton";
import { getAdminUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function AdminBlocklistPage() {
  if (!(await getAdminUser())) redirect("/login");

  const entries = await prisma.eventBlocklist.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h1 className="font-headline font-black text-3xl text-on-surface lowercase">blocklist</h1>
        <AdminNav current="blocklist" />
        <p className="font-body text-on-surface-variant text-sm">
          {entries.length} blocked event{entries.length !== 1 ? "s" : ""} · these will be skipped by all future scrapes
        </p>
      </div>

      {entries.length === 0 ? (
        <p className="font-body text-on-surface-variant">No blocked events.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="bg-surface-container rounded-2xl px-5 py-4 flex items-center gap-4"
            >
              <div className="flex-1 min-w-0">
                <h2 className="font-body font-semibold text-sm text-on-surface truncate">
                  {entry.title}
                </h2>
                <p className="font-body text-on-surface-variant text-xs mt-0.5">
                  Blocked {format(entry.createdAt, "MMM d, yyyy")}
                  {entry.reason && ` · ${entry.reason}`}
                </p>
                <p className="font-mono text-[10px] text-on-surface-variant/50 mt-0.5 truncate">
                  {entry.sourceUrl ?? entry.dedupeHash}
                </p>
              </div>
              <div className="shrink-0">
                <UnblockButton id={entry.id} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
