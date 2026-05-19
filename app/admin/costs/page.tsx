export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { format } from "date-fns";
import AdminNav from "../_components/AdminNav";
import AddCostForm from "./AddCostForm";
import DeleteCostButton from "./DeleteCostButton";
import { CostService } from "@prisma/client";

interface Props {
  searchParams: Promise<{ secret?: string }>;
}

const SERVICE_LABELS: Record<CostService, string> = {
  CLAUDE_CODE: "Claude Code",
  CLAUDE_API: "Claude API",
  APIFY: "Apify",
  RAILWAY: "Railway",
  OTHER: "Other",
};

const ALL_SERVICES: CostService[] = ["CLAUDE_CODE", "CLAUDE_API", "APIFY", "RAILWAY", "OTHER"];

function fmt(n: number) {
  return `$${n.toFixed(2)}`;
}

export default async function CostsPage({ searchParams }: Props) {
  const { secret } = await searchParams;

  if (!secret || secret !== process.env.SCRAPE_SECRET) {
    return (
      <div className="max-w-screen-md mx-auto px-6 py-16 text-center">
        <p className="font-body text-on-surface-variant">Access denied.</p>
      </div>
    );
  }

  const entries = await prisma.costEntry.findMany({
    orderBy: [{ billingMonth: "desc" }, { createdAt: "desc" }],
  });

  // All-time totals per service
  const serviceTotals = ALL_SERVICES.reduce<Record<CostService, number>>(
    (acc, s) => ({ ...acc, [s]: 0 }),
    {} as Record<CostService, number>
  );
  let allTimeTotal = 0;
  for (const e of entries) {
    serviceTotals[e.service] += e.amount;
    allTimeTotal += e.amount;
  }

  // This month totals
  const now = new Date();
  const thisMonthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const thisMonthEntries = entries.filter(
    (e) => e.billingMonth.getTime() === thisMonthStart.getTime()
  );
  const thisMonthTotal = thisMonthEntries.reduce((s, e) => s + e.amount, 0);

  // Monthly breakdown: month key → service → total
  const monthMap = new Map<string, { date: Date; services: Record<CostService, number>; total: number }>();
  for (const e of entries) {
    const key = e.billingMonth.toISOString();
    if (!monthMap.has(key)) {
      monthMap.set(key, {
        date: e.billingMonth,
        services: ALL_SERVICES.reduce((a, s) => ({ ...a, [s]: 0 }), {} as Record<CostService, number>),
        total: 0,
      });
    }
    const row = monthMap.get(key)!;
    row.services[e.service] += e.amount;
    row.total += e.amount;
  }
  const monthRows = Array.from(monthMap.values()).sort((a, b) => b.date.getTime() - a.date.getTime());

  // Average monthly spend (across months with any entries)
  const monthCount = monthRows.length;
  const avgMonthly = monthCount > 0 ? allTimeTotal / monthCount : 0;

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-8 flex flex-col gap-10">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <h1 className="font-headline font-black text-3xl text-on-surface lowercase">costs</h1>
        <AdminNav secret={secret} current="costs" />
      </div>

      {/* Summary cards */}
      <section className="flex flex-col gap-4">
        <h2 className="font-headline font-bold text-xl text-on-surface lowercase">overview</h2>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "all-time total", value: fmt(allTimeTotal) },
            { label: "this month", value: fmt(thisMonthTotal) },
            { label: "avg / month", value: monthCount > 0 ? fmt(avgMonthly) : "—" },
          ].map(({ label, value }) => (
            <div key={label} className="bg-surface-container rounded-2xl p-5">
              <p className="font-headline font-black text-3xl text-on-surface">{value}</p>
              <p className="font-body text-xs text-on-surface-variant mt-1">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Per-service totals */}
      <section className="flex flex-col gap-4">
        <h2 className="font-headline font-bold text-xl text-on-surface lowercase">by service (all-time)</h2>
        <div className="bg-surface-container rounded-2xl overflow-hidden">
          <table className="w-full font-body text-sm">
            <thead>
              <tr className="border-b border-outline-variant">
                <th className="text-left px-5 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide">service</th>
                <th className="text-right px-5 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide">total</th>
                <th className="text-right px-5 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide">share</th>
              </tr>
            </thead>
            <tbody>
              {ALL_SERVICES.filter((s) => serviceTotals[s] > 0).map((s, i, arr) => (
                <tr key={s} className={i < arr.length - 1 ? "border-b border-outline-variant" : ""}>
                  <td className="px-5 py-3 text-on-surface font-medium">{SERVICE_LABELS[s]}</td>
                  <td className="text-right px-5 py-3 text-on-surface tabular-nums">{fmt(serviceTotals[s])}</td>
                  <td className="text-right px-5 py-3 text-on-surface-variant tabular-nums">
                    {allTimeTotal > 0 ? `${((serviceTotals[s] / allTimeTotal) * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
              {allTimeTotal > 0 && (
                <tr className="border-t border-outline-variant bg-surface-container-high">
                  <td className="px-5 py-3 font-semibold text-on-surface">total</td>
                  <td className="text-right px-5 py-3 font-semibold text-on-surface tabular-nums">{fmt(allTimeTotal)}</td>
                  <td className="text-right px-5 py-3 text-on-surface-variant">100%</td>
                </tr>
              )}
              {allTimeTotal === 0 && (
                <tr>
                  <td colSpan={3} className="px-5 py-6 text-center text-on-surface-variant">No entries yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Monthly breakdown */}
      {monthRows.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-headline font-bold text-xl text-on-surface lowercase">monthly breakdown</h2>
          <div className="bg-surface-container rounded-2xl overflow-x-auto">
            <table className="w-full font-body text-sm">
              <thead>
                <tr className="border-b border-outline-variant">
                  <th className="text-left px-5 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide whitespace-nowrap">month</th>
                  {ALL_SERVICES.map((s) => (
                    <th key={s} className="text-right px-4 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide whitespace-nowrap">
                      {SERVICE_LABELS[s]}
                    </th>
                  ))}
                  <th className="text-right px-5 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide">total</th>
                </tr>
              </thead>
              <tbody>
                {monthRows.map((row, i) => (
                  <tr key={row.date.toISOString()} className={i < monthRows.length - 1 ? "border-b border-outline-variant" : ""}>
                    <td className="px-5 py-3 text-on-surface font-medium whitespace-nowrap">
                      {format(row.date, "MMM yyyy")}
                    </td>
                    {ALL_SERVICES.map((s) => (
                      <td key={s} className="text-right px-4 py-3 tabular-nums text-on-surface-variant">
                        {row.services[s] > 0 ? fmt(row.services[s]) : "—"}
                      </td>
                    ))}
                    <td className="text-right px-5 py-3 tabular-nums font-semibold text-on-surface">{fmt(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* All entries */}
      <section className="flex flex-col gap-4">
        <h2 className="font-headline font-bold text-xl text-on-surface lowercase">all entries</h2>
        {entries.length === 0 ? (
          <p className="font-body text-on-surface-variant text-sm">No entries yet. Add one below.</p>
        ) : (
          <div className="bg-surface-container rounded-2xl overflow-hidden">
            <table className="w-full font-body text-sm">
              <thead>
                <tr className="border-b border-outline-variant">
                  <th className="text-left px-5 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide">month</th>
                  <th className="text-left px-4 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide">service</th>
                  <th className="text-right px-4 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide">amount</th>
                  <th className="text-left px-4 py-3 text-on-surface-variant font-medium text-xs uppercase tracking-wide">notes</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={e.id} className={i < entries.length - 1 ? "border-b border-outline-variant" : ""}>
                    <td className="px-5 py-3 text-on-surface whitespace-nowrap">{format(e.billingMonth, "MMM yyyy")}</td>
                    <td className="px-4 py-3 text-on-surface">{SERVICE_LABELS[e.service]}</td>
                    <td className="text-right px-4 py-3 tabular-nums font-semibold text-on-surface">{fmt(e.amount)}</td>
                    <td className="px-4 py-3 text-on-surface-variant text-xs">{e.notes ?? "—"}</td>
                    <td className="text-right px-5 py-3">
                      <DeleteCostButton id={e.id} secret={secret} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Add entry form */}
      <section className="flex flex-col gap-4">
        <h2 className="font-headline font-bold text-xl text-on-surface lowercase">add entry</h2>
        <div className="bg-surface-container rounded-2xl p-5">
          <AddCostForm secret={secret} />
        </div>
      </section>
    </div>
  );
}
