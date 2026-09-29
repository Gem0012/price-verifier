"use client";

import { useEffect } from "react";
import type { Candidate, MatchResult } from "@/lib/types";
import { StatusPill, fmtMoney, fmtSigned } from "./StatusPill";

interface Props {
  result: MatchResult | null;
  jevConnected: boolean;
  /** True while a Jev screening request is in flight (single or bulk). */
  screening: boolean;
  aQty?: Record<number, number | null>;
  bQty?: Record<number, number | null>;
  onClose: () => void;
  onPick: (id: number, c: Candidate) => void;
  /** Screen just this item's chosen pair with Jev. */
  onScreen: (id: number) => void;
  /** Jump to the Settings tab (used when Jev is not connected). */
  onOpenSettings: () => void;
}

export default function ItemDetailModal({
  result,
  jevConnected,
  screening,
  aQty = {},
  bQty = {},
  onClose,
  onPick,
  onScreen,
  onOpenSettings,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!result) return null;

  const canPick =
    result.status === "MULTIPLE" ||
    result.status === "NEEDS_REVIEW" ||
    (result.status === "NOT_FOUND" && result.candidates.length > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white dark:bg-slate-900 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <StatusPill status={result.status} />
            {result.jevVerdict && (
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${JEV_BADGE_STYLES[result.jevVerdict]}`}
              >
                {result.jevVerdict === "MATCH"
                  ? "Jev-verified"
                  : result.jevVerdict === "NOT_MATCH"
                    ? "Jev-rejected"
                    : "Jev-uncertain"}
                {result.jevConfidence !== null && ` · ${result.jevConfidence}%`}
              </span>
            )}
            <span className="truncate text-sm text-slate-500 dark:text-slate-400">
              File A row {result.aRowNum}
              {result.method && ` · matched by ${result.method}`}
              {result.score !== null && ` · score ${result.score}`}
            </span>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <div className="grid gap-4 md:grid-cols-2">
            <NameBlock
              label="File A"
              raw={result.aRawName}
              cleaned={result.aCleaned}
              rawPrice={result.aRawPrice}
              price={result.aPrice}
            />
            <NameBlock
              label="File B"
              raw={result.chosen?.rawName ?? null}
              cleaned={result.chosen?.cleaned ?? null}
              rawPrice={result.chosen?.rawPrice ?? null}
              price={result.bPrice}
              rowNum={result.chosen?.bRowNum ?? null}
            />
          </div>

          <div className="grid grid-cols-3 gap-3 text-center sm:grid-cols-4">
            <Stat label="Price difference" value={result.difference == null ? "—" : fmtSigned(result.difference)} />
            <Stat label="Match score" value={result.score !== null ? String(result.score) : "—"} />
            <Stat
              label="Clean names equal?"
              value={
                result.chosen && result.chosen.cleaned === result.aCleaned ? "Yes" : "No"
              }
            />
            {(() => {
              const aq = aQty[result.aRowNum];
              const bq = result.chosen ? bQty[result.chosen.bRowNum] : undefined;
              if (aq == null && bq == null) return null;
              const mismatch = aq != null && bq != null && aq !== bq;
              return (
                <Stat
                  label="Qty (claimed → verified)"
                  value={`${aq ?? "—"} → ${bq ?? "—"}`}
                  tone={mismatch ? "bad" : "neutral"}
                />
              );
            })()}
          </div>

          {result.notes.length > 0 && (
            <ul className="space-y-1 rounded-xl bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-900 dark:text-amber-200 ring-1 ring-amber-200 dark:ring-amber-800">
              {result.notes.map((n, i) => (
                <li key={i}>• {n}</li>
              ))}
            </ul>
          )}

          {result.status === "NEEDS_REVIEW" && (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 px-4 py-3 ring-1 ring-indigo-200 dark:ring-indigo-800">
              <p className="text-sm text-indigo-900 dark:text-indigo-200">
                {result.chosen
                  ? "Uncertain match — let Jev decide if this is the same item."
                  : "Uncertain match — pick a candidate below first, then Jev can screen it."}
              </p>
              {result.chosen ? (
                jevConnected ? (
                  <button
                    onClick={() => onScreen(result.id)}
                    disabled={screening}
                    className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {screening ? "Screening…" : "Screen with Jev"}
                  </button>
                ) : (
                  <button
                    onClick={onOpenSettings}
                    title="Add your TypeSafe AI key in Settings to enable Jev screening"
                    className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
                  >
                    Connect Jev in Settings
                  </button>
                )
              ) : (
                <button
                  disabled
                  title="A File B candidate must be chosen before Jev can screen it"
                  className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                >
                  Screen with Jev
                </button>
              )}
            </div>
          )}

          {result.candidates.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Candidate matches
                {canPick && (
                  <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
                    — pick one manually to resolve this row
                  </span>
                )}
              </h3>
              <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200 dark:ring-slate-800">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      <th className="px-3 py-2 font-semibold">B row</th>
                      <th className="px-3 py-2 font-semibold">Name</th>
                      <th className="px-3 py-2 text-right font-semibold">Price</th>
                      <th className="px-3 py-2 text-right font-semibold">Score</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {result.candidates.map((c) => {
                      const isChosen = result.chosen?.bRowNum === c.bRowNum;
                      return (
                        <tr key={c.bRowNum} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500">{c.bRowNum}</td>
                          <td className="max-w-[24rem] px-3 py-2">
                            <div className="truncate text-slate-800 dark:text-slate-100" title={c.rawName}>
                              {c.rawName}
                            </div>
                            <div className="truncate text-xs text-slate-400 dark:text-slate-500" title={c.cleaned}>
                              {c.cleaned}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
                            {fmtMoney(c.price)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                            {c.similarity}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {canPick && (
                              <button
                                onClick={() => onPick(result.id, c)}
                                disabled={isChosen}
                                className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
                              >
                                {isChosen ? "Chosen" : "Use this match"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const JEV_BADGE_STYLES: Record<NonNullable<MatchResult["jevVerdict"]>, string> = {
  MATCH: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 ring-emerald-200 dark:ring-emerald-800",
  NOT_MATCH: "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 ring-rose-200 dark:ring-rose-800",
  UNCERTAIN: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 ring-amber-200 dark:ring-amber-800",
};

function NameBlock({
  label,
  raw,
  cleaned,
  rawPrice,
  price,
  rowNum = null,
}: {
  label: string;
  raw: string | null;
  cleaned: string | null;
  rawPrice: unknown;
  price: number | null;
  rowNum?: number | null;
}) {
  return (
    <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-4 py-3 ring-1 ring-slate-200 dark:ring-slate-800">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
        {rowNum !== null && ` · row ${rowNum}`}
      </p>
      <p className="mt-1 break-words text-sm font-medium text-slate-900 dark:text-slate-50">
        {raw ?? "— no match chosen —"}
      </p>
      {cleaned !== null && (
        <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">cleaned: {cleaned}</p>
      )}
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
        price: <span className="tabular-nums font-semibold">{fmtMoney(price)}</span>
        {rawPrice !== null && rawPrice !== undefined && typeof rawPrice !== "number" && (
          <span className="ml-1 text-xs text-slate-400 dark:text-slate-500">(raw: {String(rawPrice)})</span>
        )}
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "bad";
}) {
  return (
    <div className="rounded-xl bg-white dark:bg-slate-900 px-3 py-2 ring-1 ring-slate-200 dark:ring-slate-800">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
      <p
        className={`mt-0.5 text-lg font-bold tabular-nums ${
          tone === "bad" ? "text-rose-700 dark:text-rose-400" : "text-slate-800 dark:text-slate-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
