"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MatchResult, Status } from "@/lib/types";
import type { Valuation } from "@/lib/analysis";
import { StatusPill, STATUS_NAMES, fmtMoney, fmtSigned } from "./StatusPill";

export type SortKey =
  | "row"
  | "name"
  | "aPrice"
  | "bPrice"
  | "diff"
  | "score"
  | "status";

const PAGE_SIZE = 100;
const STATUS_ORDER: Status[] = [
  "CONFLICT",
  "PROBABLE",
  "UNMATCHED",
  "STRONG",
  "CONFIRMED",
];

const ROW_EDGE: Record<Status, string> = {
  CONFIRMED: "border-l-emerald-300",
  STRONG: "border-l-teal-300",
  PROBABLE: "border-l-amber-400",
  CONFLICT: "border-l-rose-400",
  UNMATCHED: "border-l-slate-300",
};

const JEV_BADGE: Record<string, { label: string; cls: string }> = {
  MATCH: { label: "Jev ✓", cls: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400" },
  NOT_MATCH: { label: "Jev ✗", cls: "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-400" },
  UNCERTAIN: { label: "Jev ?", cls: "bg-amber-100 dark:bg-amber-900/40 text-amber-700" },
};

interface Props {
  results: MatchResult[];
  problemsOnly?: boolean;
  aQty?: Record<number, number | null>;
  bQty?: Record<number, number | null>;
  aDups?: Record<number, number[]>;
  /** Costing evidence per row id — drives the range column. */
  valuations?: Map<number, Valuation>;
  onOpen: (id: number) => void;
}

export default function ResultsTable({
  results,
  problemsOnly,
  aQty = {},
  bQty = {},
  aDups = {},
  valuations,
  onOpen,
}: Props) {
  const hasQty = Object.keys(aQty).length > 0 || Object.keys(bQty).length > 0;
  const hasDups = Object.keys(aDups).length > 0;
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>(problemsOnly ? "status" : "row");
  const [asc, setAsc] = useState(true);
  const [page, setPage] = useState(0);
  const [gapPct, setGapPct] = useState<string>("");
  const [gapMode, setGapMode] = useState<"within" | "beyond">("within");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => setPage(0), [query, statusFilter, sortKey, asc, gapPct, gapMode]);

  // "/" focuses search from anywhere in the table (unless typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "SELECT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const tol = Number(gapPct);
    const tolActive = gapPct.trim() !== "" && Number.isFinite(tol) && tol >= 0;
    let list = results;
    if (problemsOnly)
      list = list.filter((r) => r.status !== "CONFIRMED" && r.status !== "STRONG");
    if (statusFilter !== "all") list = list.filter((r) => r.status === statusFilter);
    if (q) {
      list = list.filter(
        (r) =>
          r.aRawName.toLowerCase().includes(q) ||
          (r.chosen?.rawName ?? "").toLowerCase().includes(q),
      );
    }
    if (tolActive) {
      list = list.filter((r) => {
        if (r.difference === null || r.aPrice === null || r.aPrice === 0) return false;
        const pct = (Math.abs(r.difference) / r.aPrice) * 100;
        return gapMode === "within" ? pct <= tol : pct > tol;
      });
    }
    const dir = asc ? 1 : -1;
    const num = (v: number | null) => (v === null ? -Infinity : v);
    const val = (r: MatchResult): string | number => {
      switch (sortKey) {
        case "row":
          return r.aRowNum;
        case "name":
          return r.aRawName.toLowerCase();
        case "aPrice":
          return num(r.aPrice);
        case "bPrice":
          return num(r.bPrice);
        case "diff":
          return num(r.difference);
        case "score":
          return num(r.score);
        case "status":
          return STATUS_ORDER.indexOf(r.status);
      }
    };
    return [...list].sort((x, y) => {
      const a = val(x);
      const b = val(y);
      if (typeof a === "number" && typeof b === "number") return (a - b) * dir;
      return String(a).localeCompare(String(b)) * dir;
    });
  }, [results, problemsOnly, query, statusFilter, sortKey, asc, gapPct, gapMode]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setAsc(!asc);
    else {
      setSortKey(key);
      setAsc(true);
    }
  };

  const counts = useMemo(() => {
    const c = new Map<Status, number>();
    for (const r of results) {
      if (problemsOnly && (r.status === "CONFIRMED" || r.status === "STRONG")) continue;
      c.set(r.status, (c.get(r.status) ?? 0) + 1);
    }
    return c;
  }, [results, problemsOnly]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search item names…  ( / )"
            className="w-64 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 pr-8 text-sm outline-none focus:border-indigo-500"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 dark:text-slate-500 hover:text-slate-700"
            >
              ✕
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <FilterChip
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
            label={`All (${results.length.toLocaleString()})`}
          />
          {[...STATUS_ORDER.filter((s) => (counts.get(s) ?? 0) > 0 || s === "CONFLICT")].map(
            (s) => (
              <FilterChip
                key={s}
                active={statusFilter === s}
                onClick={() => setStatusFilter(s)}
                label={`${STATUS_NAMES[s]} (${counts.get(s) ?? 0})`}
              />
            ),
          )}
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1">
          <span className="text-xs whitespace-nowrap text-slate-500 dark:text-slate-400">Gap ±</span>
          <input
            type="number"
            min={0}
            value={gapPct}
            onChange={(e) => setGapPct(e.target.value)}
            placeholder="%"
            className="w-12 text-sm tabular-nums outline-none"
            title="Show items whose price gap is within (or beyond) this percentage of the File A price"
          />
          <div className="flex overflow-hidden rounded-md ring-1 ring-slate-200 dark:ring-slate-800">
            <button
              onClick={() => setGapMode("within")}
              className={`px-1.5 py-0.5 text-xs font-semibold ${
                gapMode === "within" ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900" : "bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/60"
              }`}
              title="Within the percentage"
            >
              ≤
            </button>
            <button
              onClick={() => setGapMode("beyond")}
              className={`px-1.5 py-0.5 text-xs font-semibold ${
                gapMode === "beyond" ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900" : "bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/60"
              }`}
              title="Beyond the percentage"
            >
              &gt;
            </button>
          </div>
        </div>
        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
          {rows.length.toLocaleString()} row{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200 dark:ring-slate-800">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-50 dark:bg-slate-800/60 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 shadow-[0_1px_0_0_#e2e8f0]">
              <Th sortKey="row" cur={sortKey} asc={asc} onSort={toggleSort} className="w-16">
                Row
              </Th>
              <Th sortKey="name" cur={sortKey} asc={asc} onSort={toggleSort}>
                Item
              </Th>
              {hasQty && (
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Qty
                </th>
              )}
              <Th sortKey="aPrice" cur={sortKey} asc={asc} onSort={toggleSort} className="text-right">
                A price
              </Th>
              <Th sortKey="bPrice" cur={sortKey} asc={asc} onSort={toggleSort} className="text-right">
                B price
              </Th>
              <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Costing records
              </th>
              <Th sortKey="diff" cur={sortKey} asc={asc} onSort={toggleSort} className="text-right">
                Diff
              </Th>
              <Th sortKey="score" cur={sortKey} asc={asc} onSort={toggleSort} className="text-right">
                Score
              </Th>
              <Th sortKey="status" cur={sortKey} asc={asc} onSort={toggleSort}>
                Status
              </Th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr
                key={r.id}
                onClick={() => onOpen(r.id)}
                className={`cursor-pointer border-t border-l-4 border-slate-100 dark:border-slate-800 hover:bg-indigo-50/50 dark:hover:bg-indigo-500/10 ${ROW_EDGE[r.status]}`}
              >
                <td className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500">{r.aRowNum}</td>
                <td className="max-w-[26rem] px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-slate-800 dark:text-slate-100" title={r.aRawName}>
                      {r.aRawName}
                    </span>
                    {hasDups && aDups[r.aRowNum] && (
                      <span
                        className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                        title={`Same description as File A row(s): ${aDups[r.aRowNum].join(", ")} — possible duplicate claim line`}
                      >
                        DUP
                      </span>
                    )}
                  </div>
                  {r.chosen ? (
                    <div
                      className="truncate text-xs text-slate-500 dark:text-slate-400"
                      title={r.chosen.rawName}
                    >
                      ↳ B{r.chosen.bRowNum}: {r.chosen.rawName}
                      {r.candidates.length > 1 && (
                        <span className="text-slate-400 dark:text-slate-500">
                          {" "}· +{r.candidates.length - 1} more matching record{r.candidates.length === 2 ? "" : "s"}
                        </span>
                      )}
                    </div>
                  ) : r.candidates.length > 0 ? (
                    <div className="text-xs text-slate-400 dark:text-slate-500">
                      {r.candidates.length} candidate{r.candidates.length === 1 ? "" : "s"} — open
                      to review
                    </div>
                  ) : null}
                </td>
                {hasQty && (
                  <td
                    className={`px-3 py-2 text-right text-xs tabular-nums ${
                      aQty[r.aRowNum] != null &&
                      r.chosen?.bRowNum != null &&
                      bQty[r.chosen.bRowNum] != null &&
                      aQty[r.aRowNum] !== bQty[r.chosen.bRowNum]
                        ? "font-semibold text-amber-700 dark:text-amber-400"
                        : "text-slate-500 dark:text-slate-400"
                    }`}
                    title="Claimed qty → verified qty"
                  >
                    {aQty[r.aRowNum] ?? "—"}
                    {r.chosen?.bRowNum != null && bQty[r.chosen.bRowNum] != null
                      ? ` → ${bQty[r.chosen.bRowNum]}`
                      : ""}
                  </td>
                )}
                <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
                  {fmtMoney(r.aPrice)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
                  {fmtMoney(r.bPrice)}
                </td>
                <td
                  className="px-3 py-2 text-right text-xs tabular-nums text-slate-600 dark:text-slate-300"
                  title="All costing records sharing this identity, and their price range"
                >
                  {(() => {
                    const val = valuations?.get(r.id);
                    if (!val || val.count === 0) return "—";
                    const extras = val.zeroCount > 0 ? ` (+${val.zeroCount} ₱0)` : "";
                    return (
                      <>
                        {val.count} rec{val.count === 1 ? "" : "s"}
                        <span className="block text-[11px] text-slate-400 dark:text-slate-500">
                          {fmtMoney(val.lowest)} – {fmtMoney(val.highest)}{extras}
                        </span>
                      </>
                    );
                  })()}
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums font-medium ${
                    r.difference == null
                      ? "text-slate-400 dark:text-slate-500"
                      : r.difference === 0
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-rose-700 dark:text-rose-400"
                  }`}
                >
                  {r.difference == null ? "—" : fmtSigned(r.difference)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                  {r.score ?? "—"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <StatusPill status={r.status} />
                    {r.jevVerdict && (
                      <span
                        className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold ${JEV_BADGE[r.jevVerdict]?.cls ?? ""}`}
                        title={
                          r.jevConfidence !== null
                            ? `Jev ${r.jevVerdict.toLowerCase()} · confidence ${r.jevConfidence}%`
                            : `Jev ${r.jevVerdict.toLowerCase()}`
                        }
                      >
                        {JEV_BADGE[r.jevVerdict]?.label}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={hasQty ? 9 : 8} className="px-3 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
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
            className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Page {safePage + 1} of {pageCount}
          </span>
          <button
            onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
            disabled={safePage >= pageCount - 1}
            className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition ${
        active
          ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900 ring-slate-900"
          : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-slate-300 dark:ring-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60"
      }`}
    >
      {label}
    </button>
  );
}

function Th({
  children,
  sortKey,
  cur,
  asc,
  onSort,
  className = "",
}: {
  children: React.ReactNode;
  sortKey: SortKey;
  cur: SortKey;
  asc: boolean;
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  return (
    <th className={`px-3 py-2 font-semibold ${className}`}>
      <button
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 hover:text-slate-800"
      >
        {children}
        <span className={cur === sortKey ? "text-slate-800 dark:text-slate-100" : "text-slate-300"}>
          {cur === sortKey ? (asc ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}
