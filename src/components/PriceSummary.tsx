"use client";

import { useMemo } from "react";
import type { MatchResult, Status } from "@/lib/types";
import {
  extAmount,
  overpaymentExposure,
  unmatchedBLines,
  valuationFlag,
  type Valuation,
} from "@/lib/analysis";
import { STATUS_NAMES, fmtMoney, fmtSigned } from "./StatusPill";

interface Props {
  results: MatchResult[];
  /** Costing evidence per row id (all linked records + price range). */
  valuations: Map<number, Valuation>;
  /** Depreciation allowance (%) — explains claims above the range (ACV). */
  depreciationPct: number;
  aQty?: Record<number, number | null>;
  bQty?: Record<number, number | null>;
  aDups?: Record<number, number[]>;
  bRowData?: Record<number, { name: string; price: number | null; qty: number | null; code?: string | null }>;
}

const STATUS_LIST: Status[] = ["CONFIRMED", "STRONG", "PROBABLE", "CONFLICT", "UNMATCHED"];

export default function PriceSummary({
  results,
  valuations,
  depreciationPct,
  aQty = {},
  bQty = {},
  aDups = {},
  bRowData = {},
}: Props) {
  const agg = useMemo(() => {
    let rowsWithA = 0;
    let totalA = 0;
    let rowsWithBoth = 0;
    let netDiff = 0;
    let absDiff = 0;
    let pctSum = 0;
    let pctRows = 0;
    const higher = { count: 0, amount: 0 };
    const lower = { count: 0, amount: 0 };
    let equal = 0;
    const byStatus = new Map<Status, { count: number; amountA: number; amountB: number; netDiff: number }>();
    let inRange = 0;
    let above = 0;
    let aboveAllowed = 0;
    let below = 0;
    let unpriced = 0;

    for (const r of results) {
      if (r.aPrice !== null) {
        rowsWithA++;
        totalA += r.aPrice;
      }
      if (r.aPrice !== null && r.bPrice !== null) {
        const d = r.difference ?? 0;
        const pct = (Math.abs(d) / (r.aPrice || 1)) * 100;
        rowsWithBoth++;
        netDiff += d;
        absDiff += Math.abs(d);
        pctSum += pct;
        pctRows++;
        if (d > 0) {
          higher.count++;
          higher.amount += d;
        } else if (d < 0) {
          lower.count++;
          lower.amount += -d;
        } else {
          equal++;
        }
      }
      const s = byStatus.get(r.status) ?? { count: 0, amountA: 0, amountB: 0, netDiff: 0 };
      s.count++;
      if (r.aPrice !== null) s.amountA += r.aPrice;
      if (r.bPrice !== null) s.amountB += r.bPrice;
      if (r.aPrice !== null && r.bPrice !== null) s.netDiff += r.difference ?? 0;
      byStatus.set(r.status, s);

      const flag = valuationFlag(valuations.get(r.id), r.aPrice, depreciationPct);
      if (flag === "in-range") inRange++;
      else if (flag === "above") above++;
      else if (flag === "above-allowed") aboveAllowed++;
      else if (flag === "below") below++;
      else unpriced++;
    }
    return {
      rowsWithA,
      totalA,
      rowsWithBoth,
      netDiff,
      absDiff,
      avgAbsDiffPct: pctRows ? pctSum / pctRows : 0,
      higher,
      lower,
      equal,
      byStatus: STATUS_LIST.map((status) => ({
        status,
        ...(byStatus.get(status) ?? { count: 0, amountA: 0, amountB: 0, netDiff: 0 }),
      })),
      inRange,
      above,
      aboveAllowed,
      below,
      unpriced,
      pricedRows: inRange + above + aboveAllowed + below,
    };
  }, [results, valuations, depreciationPct]);

  const inRangePct = agg.pricedRows ? (agg.inRange / agg.pricedRows) * 100 : 100;
  const exposure = useMemo(
    () => overpaymentExposure(results, valuations, depreciationPct),
    [results, valuations, depreciationPct],
  );
  const hasQty = Object.keys(aQty).length > 0 || Object.keys(bQty).length > 0;
  const hasDups = Object.keys(aDups).length > 0;
  const hasBRows = Object.keys(bRowData).length > 0;

  // Quantity check: claimed vs verified units on paired rows.
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

  // Extended amounts: claimed (qty × claimed price) vs verified.
  let claimedExt: number | null = null;
  let verifiedExt: number | null = null;
  if (hasQty) {
    for (const r of results) {
      if (!r.chosen) continue;
      const aq = aQty[r.aRowNum] ?? null;
      const bq = bQty[r.chosen.bRowNum] ?? null;
      const ca = extAmount(aq, r.aPrice);
      const cb = extAmount(bq ?? aq, r.bPrice);
      if (ca !== null) claimedExt = (claimedExt ?? 0) + ca;
      if (cb !== null) verifiedExt = (verifiedExt ?? 0) + cb;
    }
  }

  // Duplicate claim lines.
  const dupRows = Object.keys(aDups).map(Number);
  const dupClaimedValue = dupRows.reduce((sum, rn) => {
    const r = results.find((x) => x.aRowNum === rn);
    return sum + (r?.aPrice ?? 0);
  }, 0);

  // Reverse coverage: costing lines no claim row was matched to.
  const unmatched = hasBRows ? unmatchedBLines(bRowData, results) : [];
  const unmatchedValue = unmatched.reduce((s, l) => s + (l.extended ?? l.price ?? 0), 0);

  // Inventory totals in TOTAL COST (qty × unit price per line). When no qty
  // column is mapped each line is treated as one unit — labelled as such.
  const claimedInventory = results.reduce(
    (s, r) => s + (extAmount(aQty[r.aRowNum] ?? null, r.aPrice) ?? r.aPrice ?? 0),
    0,
  );
  const adjusterInventory = Object.values(bRowData).reduce(
    (s, r) => s + (extAmount(r.qty, r.price) ?? r.price ?? 0),
    0,
  );
  const inventoryVariance = adjusterInventory - claimedInventory;

  return (
    <div className="space-y-5 pb-10">
      <p className="rounded-xl bg-indigo-50 dark:bg-indigo-950/40 px-4 py-2.5 text-sm text-indigo-900 dark:text-indigo-200 ring-1 ring-indigo-200 dark:ring-indigo-800">
        <span className="font-semibold">Two inventories, fully compared.</span>{" "}
        Identity is established first (part numbers and descriptions — never by
        price); once identified, every costing record for the item is collected
        as valuation evidence below. Every row of <em>both</em> files is
        accounted for.{" "}
        {hasQty ? "" : "Map a Qty column to compute true total-cost lines (currently assuming 1 unit per line)."}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <BigStat
          label="Claim inventory total (File A)"
          sub={`${agg.rowsWithA.toLocaleString()} priced items · total cost${hasQty ? "" : " (1 unit/line)"}`}
          value={fmtMoney(claimedInventory)}
        />
        <BigStat
          label="Costing inventory total (File B)"
          sub={`${Object.keys(bRowData).length.toLocaleString()} rows · total cost${hasQty ? "" : " (1 unit/line)"}`}
          value={fmtMoney(adjusterInventory)}
        />
        <BigStat
          label="Inventory variance"
          sub="costing − claim"
          value={fmtSigned(inventoryVariance)}
          tone={inventoryVariance > 0 ? "bad" : inventoryVariance < 0 ? "good" : "neutral"}
        />
        <BigStat
          label="Total absolute gap"
          sub="sum of every unit-price difference (paired reference records)"
          value={fmtMoney(agg.absDiff)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MiniStat
          label="In costing range"
          value={`${inRangePct.toFixed(1)}%`}
          sub={`${agg.inRange.toLocaleString()} of ${agg.pricedRows.toLocaleString()} priced identified rows sit inside the lowest–highest costing range`}
          tone={inRangePct >= 95 ? "good" : inRangePct >= 80 ? "neutral" : "bad"}
        />
        <MiniStat
          label="Above the range"
          value={agg.above.toLocaleString()}
          sub={`claimed above every costing record${depreciationPct > 0 ? ` (±${agg.aboveAllowed.toLocaleString()} explained by the −${depreciationPct}% allowance)` : ""}`}
          tone="bad"
        />
        <MiniStat
          label="Below the range"
          value={agg.below.toLocaleString()}
          sub="claimed below the cheapest costing record"
        />
        <MiniStat label="Average gap" value={`${agg.avgAbsDiffPct.toFixed(1)}%`} sub="mean |Verified − Claim| on reference records" />
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
              claimed vs verified units on paired rows
            </span>
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Claimed units" value={claimedUnits.toLocaleString()} sub={`${qtyRows} rows with qty`} />
            <MiniStat label="Verified units" value={verifiedUnits.toLocaleString()} sub="costing side" />
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

      {hasQty && (
        <div className="rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-sm ring-1 ring-slate-200 dark:ring-slate-800">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Extended amounts
            <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
              quantity × unit price on paired rows — the totals claims are argued in
            </span>
          </h3>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MiniStat label="Claimed amount" value={fmtMoney(claimedExt)} sub="Σ claimed qty × claimed price" />
            <MiniStat label="Verified amount" value={fmtMoney(verifiedExt)} sub="Σ verified qty × verified price" />
            <MiniStat
              label="Net amount gap"
              value={fmtSigned((verifiedExt ?? 0) - (claimedExt ?? 0))}
              sub="verified − claimed"
              tone={(verifiedExt ?? 0) - (claimedExt ?? 0) > 0 ? "bad" : "good"}
            />
          </div>
        </div>
      )}

      {hasDups && (
        <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/40 p-5 ring-1 ring-amber-200 dark:ring-amber-800">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Duplicate claim lines
          </h3>
          <p className="mt-1 text-2xl font-bold text-amber-800 dark:text-amber-300">
            {dupRows.length.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            File A rows sharing an identical description with another row — worth{" "}
            {fmtMoney(dupClaimedValue)} combined. Possible double-dipping; each row is badged
            <span className="mx-1 rounded bg-amber-100 px-1 font-bold dark:bg-amber-900/40">DUP</span>
            in the Full Audit with its partner row numbers.
          </p>
        </div>
      )}

      {hasBRows && unmatched.length > 0 && (
        <div className="rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-sm ring-1 ring-slate-200 dark:ring-slate-800">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Unmatched costing lines
            <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
              File B rows no claim item references — reconciliation in reverse
            </span>
          </h3>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MiniStat
              label="Unmatched lines"
              value={unmatched.length.toLocaleString()}
              sub={`of ${Object.keys(bRowData).length.toLocaleString()} costing rows`}
              tone={unmatched.length > 0 ? "bad" : "good"}
            />
            <MiniStat
              label="Their total value"
              value={fmtMoney(unmatchedValue)}
              sub="Σ extended or unit price"
            />
            <MiniStat
              label="Claimed lines"
              value={results.length.toLocaleString()}
              sub="File A rows checked"
            />
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-indigo-600 dark:text-indigo-400">
              Show first 20 unmatched lines
            </summary>
            <div className="mt-2 overflow-x-auto rounded-lg ring-1 ring-slate-200 dark:ring-slate-800">
              <table className="min-w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                    <th className="px-2 py-1.5 font-semibold">B row</th>
                    <th className="px-2 py-1.5 font-semibold">Description</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Qty</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Price</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {unmatched.slice(0, 20).map((l) => (
                    <tr key={l.rowNum} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-2 py-1.5 text-slate-400">{l.rowNum}</td>
                      <td className="max-w-[24rem] truncate px-2 py-1.5 text-slate-700 dark:text-slate-200" title={l.name}>
                        {l.name}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{l.qty ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(l.price)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(l.extended)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {unmatched.length > 20 && (
                <p className="border-t border-slate-100 dark:border-slate-800 px-2 py-1.5 text-[11px] text-slate-400">
                  + {(unmatched.length - 20).toLocaleString()} more — see the Adjuster Ledger sheet in the Excel export.
                </p>
              )}
            </div>
          </details>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-rose-50 dark:bg-rose-950/40 p-5 ring-1 ring-rose-200 dark:ring-rose-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-400">
            Overpayment exposure (claim above the entire costing range)
          </p>
          <p className="mt-1 text-2xl font-bold text-rose-800 dark:text-rose-300">{fmtMoney(exposure.amount)}</p>
          <p className="mt-1 text-xs text-rose-600">
            Σ (claimed − highest costing price) across {exposure.count.toLocaleString()} item{exposure.count === 1 ? "" : "s"}
            {depreciationPct > 0 ? ` — claims within the −${depreciationPct}% depreciation allowance are excluded` : ""}
          </p>
        </div>
        <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 p-5 ring-1 ring-emerald-200 dark:ring-emerald-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            Costing below claim (potential undercharge)
          </p>
          <p className="mt-1 text-2xl font-bold text-emerald-800 dark:text-emerald-300">{fmtMoney(agg.lower.amount)}</p>
          <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
            net gap on reference records: {fmtSigned(agg.netDiff)}
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
