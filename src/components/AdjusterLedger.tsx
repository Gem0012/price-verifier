"use client";

import { useEffect, useMemo, useState } from "react";
import type { Candidate, MatchResult } from "@/lib/types";
import { extAmount } from "@/lib/analysis";
import { normalizeDescription, numericSiblingPenaltyTokens, similarity, tokenCounts } from "@/lib/normalize";
import { fmtMoney } from "./StatusPill";

const PAGE_SIZE = 100;

interface Props {
  /** Every File B row keyed by rowNum: name, unit price, qty. */
  bRowData: Record<number, { name: string; price: number | null; qty: number | null }>;
  /** Match decisions — a B row is "matched" when some claim row chose it. */
  results: MatchResult[];
  /** Manually pair an unmatched adjuster row with a claim row (same as a pick). */
  onPick: (id: number, c: Candidate) => void;
}

interface LedgerRow {
  rowNum: number;
  name: string;
  price: number | null;
  qty: number | null;
  total: number | null;
  matched: boolean;
  matchedARow: number | null;
  matchedAName: string | null;
}

/**
 * Reverse name search: score an unmatched adjuster row against EVERY claim
 * item and return the closest ones. Uses max(similarity(A,B), similarity(B,A))
 * — the same asymmetric dice the engine uses — plus the numeric-sibling
 * penalty, so "6203" suggestions don't outrank real word matches.
 */
function findCandidateClaims(
  bName: string,
  results: MatchResult[],
): { result: MatchResult; sim: number }[] {
  const bClean = normalizeDescription(bName);
  const bTokens = tokenCounts(bClean);
  const scored = results.map((r) => {
    const aTokens = tokenCounts(r.aCleaned);
    const forward = similarity(r.aCleaned, bClean);
    const reverse = similarity(bClean, r.aCleaned);
    const penalty = numericSiblingPenaltyTokens(aTokens, bTokens);
    return { result: r, sim: Math.max(0, Math.max(forward, reverse) - penalty) };
  });
  return scored.sort((x, y) => y.sim - x.sim).slice(0, 8);
}

/**
 * The adjuster-side inventory ledger: EVERY File B row is listed here —
 * matched (with the claim row it supports) or unmatched. Nothing from
 * either file is ever dropped from the comparison.
 */
export default function AdjusterLedger({ bRowData, results, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "matched" | "unmatched">("all");
  const [page, setPage] = useState(0);
  const [reverseRow, setReverseRow] = useState<LedgerRow | null>(null);

  const matchedByB = useMemo(() => {
    const m = new Map<number, { aRow: number; aName: string }>();
    for (const r of results) {
      if (r.chosen && !m.has(r.chosen.bRowNum)) {
        m.set(r.chosen.bRowNum, { aRow: r.aRowNum, aName: r.aRawName });
      }
    }
    return m;
  }, [results]);

  const rows = useMemo(() => {
    const ledger: LedgerRow[] = Object.entries(bRowData).map(([numStr, row]) => {
      const rowNum = Number(numStr);
      const m = matchedByB.get(rowNum);
      return {
        rowNum,
        name: row.name,
        price: row.price,
        qty: row.qty,
        total: extAmount(row.qty, row.price) ?? row.price,
        matched: !!m,
        matchedARow: m?.aRow ?? null,
        matchedAName: m?.aName ?? null,
      };
    });
    const q = query.trim().toLowerCase();
    let list = ledger;
    if (filter === "matched") list = list.filter((r) => r.matched);
    if (filter === "unmatched") list = list.filter((r) => !r.matched);
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q));
    // Unmatched first (they need attention), then by row number.
    return list.sort((x, y) => (x.matched === y.matched ? x.rowNum - y.rowNum : x.matched ? 1 : -1));
  }, [bRowData, matchedByB, query, filter]);

  useEffect(() => setPage(0), [query, filter]);

  const counts = useMemo(() => {
    let matched = 0;
    for (const r of results) if (r.chosen) matched++;
    return { matched, unmatched: Object.keys(bRowData).length - matched, all: Object.keys(bRowData).length };
  }, [bRowData, results]);

  const inventoryTotal = useMemo(
    () =>
      Object.values(bRowData).reduce(
        (s, r) => s + (extAmount(r.qty, r.price) ?? r.price ?? 0),
        0,
      ),
    [bRowData],
  );

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <div className="space-y-3 pb-10">
      <p className="rounded-xl bg-white dark:bg-slate-900 px-4 py-2.5 text-sm text-slate-600 dark:text-slate-300 ring-1 ring-slate-200 dark:ring-slate-800">
        Every adjuster row is listed here — nothing is dropped. Inventory total
        (qty × unit price):{" "}
        <span className="font-semibold tabular-nums">{fmtMoney(inventoryTotal)}</span>
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search adjuster items…"
          className="w-64 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-indigo-500"
        />
        {(["all", "matched", "unmatched"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition ${
              filter === f
                ? "bg-slate-900 text-white ring-slate-900 dark:bg-white dark:text-slate-900 dark:ring-white"
                : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
            }`}
          >
            {f === "all"
              ? `All (${counts.all.toLocaleString()})`
              : f === "matched"
                ? `Matched (${counts.matched.toLocaleString()})`
                : `Unmatched (${counts.unmatched.toLocaleString()})`}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
          {rows.length.toLocaleString()} row{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200 dark:ring-slate-800">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_#e2e8f0] dark:bg-slate-800 dark:text-slate-300 dark:shadow-[0_1px_0_0_#1e293b]">
              <th className="px-3 py-2 font-semibold">B row</th>
              <th className="px-3 py-2 font-semibold">Description</th>
              <th className="px-3 py-2 text-right font-semibold">Qty</th>
              <th className="px-3 py-2 text-right font-semibold">Unit price</th>
              <th className="px-3 py-2 text-right font-semibold">Total cost</th>
              <th className="px-3 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr
                key={r.rowNum}
                className={`border-t border-slate-100 dark:border-slate-800 ${
                  r.matched ? "" : "bg-amber-50/40 dark:bg-amber-950/20"
                }`}
              >
                <td className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500">{r.rowNum}</td>
                <td className="max-w-[26rem] px-3 py-2">
                  <div className="truncate font-medium text-slate-800 dark:text-slate-100" title={r.name}>
                    {r.name}
                  </div>
                  {r.matched && r.matchedAName && (
                    <div
                      className="truncate text-xs text-emerald-600 dark:text-emerald-400"
                      title={r.matchedAName}
                    >
                      ↳ supports claim row {r.matchedARow}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
                  {r.qty ?? "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
                  {fmtMoney(r.price)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-800 dark:text-slate-100">
                  {fmtMoney(r.total)}
                </td>
                <td className="px-3 py-2">
                  {r.matched ? (
                    <span className="inline-flex items-center whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:ring-emerald-800">
                      Matched → A{r.matchedARow}
                    </span>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex items-center whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:ring-amber-800">
                        Unmatched
                      </span>
                      <button
                        onClick={() => setReverseRow(r)}
                        className="whitespace-nowrap rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500"
                        title="Search File A for possible matches to this row"
                      >
                        Find matches
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
                  No rows match the current search/filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button
            onClick={() => setPage(Math.max(0, safePage - 1))}
            disabled={safePage === 0}
            className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Page {safePage + 1} of {pageCount}
          </span>
          <button
            onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
            disabled={safePage >= pageCount - 1}
            className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}

      {reverseRow && (
        <ReverseMatchModal
          row={reverseRow}
          results={results}
          onClose={() => setReverseRow(null)}
          onAssign={(claimRowId, sim) => {
            const cand: Candidate = {
              bRowNum: reverseRow.rowNum,
              rawName: reverseRow.name,
              cleaned: normalizeDescription(reverseRow.name),
              rawPrice: reverseRow.price,
              price: reverseRow.price,
              similarity: sim,
            };
            onPick(claimRowId, cand);
            setReverseRow(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Reverse-matching modal: shows the claim items closest to an unmatched
 * adjuster row. Picking one sets that claim row's chosen match to this
 * adjuster row (re-pricing it) — the same code path as a manual pick.
 */
function ReverseMatchModal({
  row,
  results,
  onClose,
  onAssign,
}: {
  row: LedgerRow;
  results: MatchResult[];
  onClose: () => void;
  onAssign: (claimRowId: number, sim: number) => void;
}) {
  const candidates = useMemo(() => findCandidateClaims(row.name, results), [row, results]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 border-b border-slate-100 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                Unmatched adjuster row {row.rowNum} — find its claim item
              </p>
              <p className="mt-1 truncate text-sm font-medium text-slate-900 dark:text-slate-50" title={row.name}>
                {row.name}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                qty {row.qty ?? "—"} · unit {fmtMoney(row.price)} · total {fmtMoney(row.total)}
              </p>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </div>
        <div className="space-y-2 px-5 py-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Closest claim rows by name (matched first — picking one re-points that claim row to
            this adjuster row):
          </p>
          {candidates.map(({ result, sim }) => {
            const currentB = result.chosen?.bRowNum;
            return (
              <div
                key={result.id}
                className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:ring-slate-700"
              >
                <span
                  className={`w-12 shrink-0 text-right text-sm font-bold tabular-nums ${
                    sim >= 90 ? "text-emerald-600 dark:text-emerald-400" : sim >= 70 ? "text-slate-800 dark:text-slate-100" : "text-slate-400"
                  }`}
                >
                  {sim}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100" title={result.aRawName}>
                    A{result.aRowNum} · {result.aRawName}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    claimed {fmtMoney(result.aPrice)}
                    {currentB != null && (
                      <span className="ml-1 text-amber-600 dark:text-amber-400">
                        · currently matched to B{currentB}
                      </span>
                    )}
                    {result.status === "NOT_FOUND" && " · was not found"}
                    {result.status === "NEEDS_REVIEW" && " · was in review"}
                  </p>
                </div>
                <button
                  onClick={() => onAssign(result.id, sim)}
                  className="shrink-0 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                >
                  Match
                </button>
              </div>
            );
          })}
          {candidates.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-400">No claim rows to compare.</p>
          )}
        </div>
      </div>
    </div>
  );
}
