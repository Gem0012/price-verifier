"use client";

import type { MatchResult } from "@/lib/types";
import { STATUS_NAMES, fmtMoney, fmtSigned } from "./StatusPill";

interface Props {
  results: MatchResult[];
  /** Price tolerance (%) used on the last run — drives the claim-accuracy stat. */
  tolerancePct: number;
  aQty?: Record<number, number | null>;
  bQty?: Record<number, number | null>;
}

interface Aggregates {
  rowsWithA: number;
  rowsWithBoth: number;
  totalA: number;
  totalB: number;
  netDiff: number;
  absDiff: number;
  avgAbsDiffPct: number;
  maxAbsDiffPct: number;
  higher: { count: number; amount: number };
  lower: { count: number; amount: number };
  equal: number;
  mismatch: { count: number; amountA: number; netDiff: number; overpay: number; underpay: number };
  byStatus: {
    status: MatchResult["status"];
    count: number;
    amountA: number;
    amountB: number;
    netDiff: number;
  }[];
}

function aggregate(
  results: MatchResult[],
  tolerancePct: number,
): { agg: Aggregates; withinTolerance: number; pricedRows: number } {
  const a: Aggregates = {
    rowsWithA: 0,
    rowsWithBoth: 0,
    totalA: 0,
    totalB: 0,
    netDiff: 0,
    absDiff: 0,
    avgAbsDiffPct: 0,
    maxAbsDiffPct: 0,
    higher: { count: 0, amount: 0 },
    lower: { count: 0, amount: 0 },
    equal: 0,
    mismatch: { count: 0, amountA: 0, netDiff: 0, overpay: 0, underpay: 0 },
    byStatus: [],
  };
  const byStatus = new Map<MatchResult["status"], { count: number; amountA: number; amountB: number; netDiff: number }>();
  let pctSum = 0;
  let pctRows = 0;

  for (const r of results) {
    if (r.aPrice !== null) {
      a.rowsWithA++;
      a.totalA += r.aPrice;
    }
    if (r.bPrice !== null && r.chosen) a.totalB += r.bPrice;
    if (r.aPrice !== null && r.bPrice !== null) {
      const d = r.difference ?? 0;
      const pct = (Math.abs(d) / (r.aPrice || 1)) * 100;
      a.rowsWithBoth++;
      a.netDiff += d;
      a.absDiff += Math.abs(d);
      pctSum += pct;
      pctRows++;
      if (pct > a.maxAbsDiffPct) a.maxAbsDiffPct = pct;
      if (d > 0) {
        a.higher.count++;
        a.higher.amount += d;
      } else if (d < 0) {
        a.lower.count++;
        a.lower.amount += -d;
      } else {
        a.equal++;
      }
    }
    const s = byStatus.get(r.status) ?? { count: 0, amountA: 0, amountB: 0, netDiff: 0 };
    s.count++;
    if (r.aPrice !== null) s.amountA += r.aPrice;
    if (r.bPrice !== null && r.chosen) s.amountB += r.bPrice;
    if (r.aPrice !== null && r.bPrice !== null) s.netDiff += r.difference ?? 0;
    byStatus.set(r.status, s);
    if (r.status === "MISMATCH" && r.aPrice !== null && r.bPrice !== null) {
      const d = r.difference ?? 0;
      a.mismatch.count++;
      a.mismatch.amountA += r.aPrice;
      a.mismatch.netDiff += d;
      if (d > 0) a.mismatch.overpay += d;
      else if (d < 0) a.mismatch.underpay += -d;
    }
  }
  a.avgAbsDiffPct = pctRows ? pctSum / pctRows : 0;
  const statusList: MatchResult["status"][] = [
    "MATCH",
    "MISMATCH",
    "MULTIPLE",
    "NEEDS_REVIEW",
    "NOT_FOUND",
  ];
  a.byStatus = statusList
    .filter((s) => byStatus.has(s))
    .map((status) => ({ status, ...byStatus.get(status)! }));
  let withinTolerance = 0;
  for (const r of results) {
    if (r.aPrice !== null && r.bPrice !== null) {
      const pct = (Math.abs(r.difference ?? 0) / (r.aPrice || 1)) * 100;
      if (pct <= tolerancePct) withinTolerance++;
    }
  }
  return { agg: a, withinTolerance, pricedRows: pctRows };
}

export default function PriceSummary({
  results,
  tolerancePct,
  aQty = {},
  bQty = {},
}: Props) {
  const { agg, withinTolerance, pricedRows } = aggregate(results, tolerancePct);
  const accuracyPct = pricedRows ? (withinTolerance / pricedRows) * 100 : 100;
  const hasQty = Object.keys(aQty).length > 0 || Object.keys(bQty).length > 0;

  // Quantity check: claimed vs verified units over matched rows.
  let qtyRows = 0;
  let claimedUnits = 0;
  let verifiedUnits = 0;
  let qtyMismatch = 0;
  if (hasQty) {
    for (const r of results) {
      if (!r.chosen) continue;
      const aq = aQty[r.aRowNum];
      const bq = bQty[r.chosen.bRowNum];
      if (aq == null && bq == null) continue;
      qtyRows++;
      claimedUnits += aq ?? 0;
      verifiedUnits += bq ?? 0;
      if (aq !== bq) qtyMismatch++;
    }
  }

  return (
    <div className="space-y-5 pb-10">
      <p className="rounded-xl bg-indigo-50 dark:bg-indigo-950/40 px-4 py-2.5 text-sm text-indigo-900 dark:text-indigo-200 ring-1 ring-indigo-200 dark:ring-indigo-800">
        <span className="font-semibold">File A = the supplier&apos;s claim.</span>{" "}
        File B = third-party verification. This summary shows how truthful the
        claim is: where the verified prices agree, and where they diverge.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <BigStat
          label="Claimed total (File A)"
          sub={`${agg.rowsWithA.toLocaleString()} priced items`}
          value={fmtMoney(agg.totalA)}
        />
        <BigStat
          label="Verified total (File B)"
          sub="matched rows only"
          value={fmtMoney(agg.totalB)}
        />
        <BigStat
          label="Net gap (Verified − Claimed)"
          sub="rows with both prices"
          value={fmtSigned(agg.netDiff)}
          tone={agg.netDiff > 0 ? "bad" : agg.netDiff < 0 ? "good" : "neutral"}
        />
        <BigStat
          label="Total absolute gap"
          sub="sum of every price difference"
          value={fmtMoney(agg.absDiff)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MiniStat
          label="Claim accuracy"
          value={`${accuracyPct.toFixed(1)}%`}
          sub={`${withinTolerance.toLocaleString()} of ${pricedRows.toLocaleString()} priced rows within ±${tolerancePct}%`}
          tone={accuracyPct >= 95 ? "good" : accuracyPct >= 80 ? "neutral" : "bad"}
        />
        <MiniStat label="Average gap" value={`${agg.avgAbsDiffPct.toFixed(1)}%`} sub="mean |Verified − Claim|" />
        <MiniStat label="Largest gap" value={`${agg.maxAbsDiffPct.toFixed(1)}%`} sub="worst single item" />
        <MiniStat
          label="Verified above claim"
          value={agg.higher.count.toLocaleString()}
          sub={`by ${fmtMoney(agg.higher.amount)} total`}
          tone="bad"
        />
        <MiniStat
          label="Verified below claim"
          value={agg.lower.count.toLocaleString()}
          sub={`by ${fmtMoney(agg.lower.amount)} total`}
          tone="good"
        />
      </div>

      {hasQty && (
        <div className="rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-sm ring-1 ring-slate-200 dark:ring-slate-800">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Quantity check
            <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
              claimed vs verified units on matched rows
            </span>
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Claimed units" value={claimedUnits.toLocaleString()} sub={`${qtyRows} rows with qty`} />
            <MiniStat label="Verified units" value={verifiedUnits.toLocaleString()} sub="adjuster side" />
            <MiniStat
              label="Net unit gap"
              value={fmtSigned(verifiedUnits - claimedUnits)}
              sub="verified − claimed"
              tone={verifiedUnits - claimedUnits > 0 ? "good" : verifiedUnits - claimedUnits < 0 ? "bad" : "neutral"}
            />
            <MiniStat
              label="Qty discrepancies"
              value={qtyMismatch.toLocaleString()}
              sub="rows where units differ"
              tone={qtyMismatch > 0 ? "bad" : "good"}
            />
          </div>
          {qtyMismatch > 0 && (
            <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
              Quantity differences matter even when unit prices match — check these rows in the
              Full Audit (amber Qty column).
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-rose-50 dark:bg-rose-950/40 p-5 ring-1 ring-rose-200 dark:ring-rose-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-400">
            Potential overpayment (discrepancies where verified &gt; claim)
          </p>
          <p className="mt-1 text-2xl font-bold text-rose-800 dark:text-rose-300">{fmtMoney(agg.mismatch.overpay)}</p>
          <p className="mt-1 text-xs text-rose-600">
            across {agg.mismatch.count} discrepant item{agg.mismatch.count === 1 ? "" : "s"} worth{" "}
            {fmtMoney(agg.mismatch.amountA)} at claimed prices
          </p>
        </div>
        <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 p-5 ring-1 ring-emerald-200 dark:ring-emerald-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            Verified below claim (potential undercharge)
          </p>
          <p className="mt-1 text-2xl font-bold text-emerald-800 dark:text-emerald-300 dark:text-emerald-300">{fmtMoney(agg.mismatch.underpay)}</p>
          <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
            net discrepancy gap: {fmtSigned(agg.mismatch.netDiff)}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200 dark:ring-slate-800">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/60 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 text-right font-semibold">Items</th>
              <th className="px-3 py-2 text-right font-semibold">Σ A price</th>
              <th className="px-3 py-2 text-right font-semibold">Σ B price</th>
              <th className="px-3 py-2 text-right font-semibold">Σ difference</th>
            </tr>
          </thead>
          <tbody>
            {agg.byStatus.map((s) => (
              <tr key={s.status} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">{STATUS_NAMES[s.status]}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.count.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(s.amountA)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(s.amountB)}</td>
                <td
                  className={`px-3 py-2 text-right tabular-nums font-medium ${
                    s.netDiff > 0 ? "text-rose-700 dark:text-rose-400" : s.netDiff < 0 ? "text-emerald-700 dark:text-emerald-400" : "text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {s.count && s.amountB ? fmtSigned(s.netDiff) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BigStat({
  label,
  sub,
  value,
  tone = "neutral",
}: {
  label: string;
  sub: string;
  value: string;
  tone?: "neutral" | "good" | "bad";
}) {
  const color =
    tone === "good" ? "text-emerald-700 dark:text-emerald-400" : tone === "bad" ? "text-rose-700 dark:text-rose-400" : "text-slate-900 dark:text-slate-50";
  return (
    <div className="rounded-2xl bg-white dark:bg-slate-900 p-4 shadow-sm ring-1 ring-slate-200 dark:ring-slate-800">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{sub}</p>
    </div>
  );
}

function MiniStat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "good" | "bad";
}) {
  const color =
    tone === "good" ? "text-emerald-700 dark:text-emerald-400" : tone === "bad" ? "text-rose-700 dark:text-rose-400" : "text-slate-800 dark:text-slate-100";
  return (
    <div className="rounded-2xl bg-white dark:bg-slate-900 p-4 shadow-sm ring-1 ring-slate-200 dark:ring-slate-800">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-0.5 text-xl font-bold tabular-nums ${color}`}>{value}</p>
      <p className="text-[11px] text-slate-400 dark:text-slate-500">{sub}</p>
    </div>
  );
}
