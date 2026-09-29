"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import type { ParsedWorkbook } from "@/lib/parse";
import type { AnalyzedSheet } from "@/lib/types";
import { analyzeFileHealth } from "@/lib/preflight";
import type { FileHealth } from "@/lib/preflight";

export interface SideState {
  parsed: ParsedWorkbook | null;
  sheetIdx: number;
  headerRow: number;
  nameCol: number;
  priceCol: number;
  qtyCol: number | null;
  loading: boolean;
  error: string | null;
}

export const EMPTY_SIDE: SideState = {
  parsed: null,
  sheetIdx: 0,
  headerRow: 0,
  nameCol: 0,
  priceCol: 1,
  qtyCol: null,
  loading: false,
  error: null,
};

type Side = "A" | "B";

interface Accent {
  badge: string;
  dropHover: string;
  dropIcon: string;
  nameHead: string;
  priceHead: string;
  nameDot: string;
  priceDot: string;
  button: string;
}

const ACCENTS: Record<Side, Accent> = {
  A: {
    badge: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
    dropHover: "border-indigo-400 bg-indigo-50/60 dark:border-indigo-500 dark:bg-indigo-500/10",
    dropIcon: "text-indigo-500 dark:text-indigo-400",
    nameHead: "bg-indigo-600 text-white dark:bg-indigo-500",
    priceHead:
      "bg-indigo-100 text-indigo-800 ring-1 ring-indigo-300 dark:bg-indigo-500/20 dark:text-indigo-300 dark:ring-indigo-500/40",
    nameDot: "bg-indigo-600 dark:bg-indigo-400",
    priceDot: "bg-indigo-200 ring-1 ring-indigo-400 dark:bg-indigo-500/40 dark:ring-indigo-500",
    button: "text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300",
  },
  B: {
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
    dropHover: "border-emerald-400 bg-emerald-50/60 dark:border-emerald-500 dark:bg-emerald-500/10",
    dropIcon: "text-emerald-500 dark:text-emerald-400",
    nameHead: "bg-emerald-600 text-white dark:bg-emerald-500",
    priceHead:
      "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:ring-emerald-500/40",
    nameDot: "bg-emerald-600 dark:bg-emerald-400",
    priceDot: "bg-emerald-200 ring-1 ring-emerald-400 dark:bg-emerald-500/40 dark:ring-emerald-500",
    button: "text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300",
  },
};

const STEPS = [
  {
    title: "Drop both files",
    text: ".xlsx, .xls or .csv — parsed locally in your browser.",
  },
  {
    title: "Check the mapping",
    text: "Pick the sheet, header row, and the name & price columns.",
  },
  {
    title: "Run comparison",
    text: "See matches and price differences in seconds.",
  },
];

interface UploadScreenProps {
  sideA: SideState;
  sideB: SideState;
  analysisA: AnalyzedSheet | null;
  analysisB: AnalyzedSheet | null;
  onFile: (side: Side, file: File) => void;
  onUpdate: (side: Side, patch: Partial<SideState>) => void;
  onClear: (side: Side) => void;
  onRun: () => void;
  canRun: boolean;
  busy: boolean;
  progress: { done: number; total: number } | null;
  runError: string | null;
}

export default function UploadScreen({
  sideA,
  sideB,
  analysisA,
  analysisB,
  onFile,
  onUpdate,
  onClear,
  onRun,
  canRun,
  busy,
  progress,
  runError,
}: UploadScreenProps) {
  const mappingHint =
    !canRun && !busy && sideA.parsed && sideB.parsed
      ? "Almost there — check the header row and column mapping above (name and price columns must differ)."
      : null;

  return (
    <div className="space-y-6">
      <HowItWorks />

      <div className="grid gap-6 lg:grid-cols-2">
        <FileSideCard
          side="A"
          title="File A — Masterlist"
          hint="Source of truth for prices. Item names contain the item code."
          state={sideA}
          analysis={analysisA}
          onFile={onFile}
          onUpdate={onUpdate}
          onClear={onClear}
        />
        <FileSideCard
          side="B"
          title="File B — Prices to verify"
          hint="Descriptions only. Same items, possibly worded differently."
          state={sideB}
          analysis={analysisB}
          onFile={onFile}
          onUpdate={onUpdate}
          onClear={onClear}
        />
      </div>

      {runError && (
        <p
          role="alert"
          className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:ring-rose-800"
        >
          {runError}
        </p>
      )}

      <div className="sticky bottom-0 z-10 -mx-4 bg-slate-100/90 px-4 pb-4 pt-3 backdrop-blur-sm sm:-mx-6 dark:bg-slate-950/90 lg:static lg:mx-0 lg:rounded-b-2xl lg:bg-transparent lg:px-0 lg:pb-10 lg:pt-0 lg:backdrop-blur-none">
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={onRun}
            disabled={!canRun || busy}
            className="flex w-full max-w-md items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none disabled:active:scale-100 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
          >
            {busy ? (
              <>
                <svg
                  aria-hidden
                  className="h-5 w-5 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-90"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v2a6 6 0 00-6 6H4z"
                  />
                </svg>
                Matching…
              </>
            ) : (
              <>
                <svg
                  aria-hidden
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z"
                  />
                </svg>
                Run comparison
              </>
            )}
          </button>
          <p className="text-center text-xs text-slate-500 dark:text-slate-400">
            Files are parsed and matched entirely in your browser — nothing is
            uploaded to any server.
          </p>
          {mappingHint && (
            <p className="max-w-md rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-800 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800">
              {mappingHint}
            </p>
          )}
          {busy && progress && (
            <div
              className="w-full max-w-md"
              role="progressbar"
              aria-label="Matching progress"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
            >
              <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-indigo-600 transition-all"
                  style={{
                    width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-center text-xs text-slate-500 dark:text-slate-400">
                {progress.done} / {progress.total} items
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <ol className="grid gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800 sm:grid-cols-3 sm:gap-4">
      {STEPS.map((s, i) => (
        <li key={s.title} className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300"
          >
            {i + 1}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{s.title}</p>
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{s.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function FileSideCard({
  side,
  title,
  hint,
  state,
  analysis,
  onFile,
  onUpdate,
  onClear,
}: {
  side: Side;
  title: string;
  hint: string;
  state: SideState;
  analysis: AnalyzedSheet | null;
  onFile: (side: Side, file: File) => void;
  onUpdate: (side: Side, patch: Partial<SideState>) => void;
  onClear: (side: Side) => void;
}) {
  const accent = ACCENTS[side];
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  // Health check for the currently chosen sheet/mapping. analysis is derived
  // from (parsed, sheetIdx, headerRow) upstream; nameCol/priceCol are passed
  // as overrides because analysis.mapping only holds the auto-detected ones.
  const health = useMemo(() => {
    const parsed = state.parsed;
    if (!parsed || !analysis) return null;
    if (!parsed.sheets[state.sheetIdx]) return null;
    return analyzeFileHealth(parsed, analysis, {
      headerRow: state.headerRow,
      nameCol: state.nameCol,
      priceCol: state.priceCol,
    });
  }, [state.parsed, state.sheetIdx, state.headerRow, state.nameCol, state.priceCol, analysis]);

  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (f) onFile(side, f);
  };

  const openPicker = () => inputRef.current?.click();

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <span
            className={`mr-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold ${accent.badge}`}
          >
            {side}
          </span>
          <span className="font-semibold text-slate-900 dark:text-slate-50">{title}</span>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
        </div>
        {state.parsed && (
          <button
            onClick={() => onClear(side)}
            className={`shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${accent.button}`}
          >
            Remove
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = "";
        }}
      />

      {!state.parsed ? (
        state.loading ? (
          <LoadingSkeleton />
        ) : (
          <div
            role="button"
            tabIndex={0}
            aria-label={`Choose spreadsheet for ${title}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              pick(e.dataTransfer.files);
            }}
            onClick={openPicker}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openPicker();
              }
            }}
            className={`flex h-44 cursor-pointer select-none flex-col items-center justify-center rounded-xl border-2 border-dashed outline-none transition focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-100 dark:focus-visible:ring-indigo-900/40 ${
              drag
                ? `${accent.dropHover} scale-[1.01]`
                : "border-slate-300 hover:border-slate-400 hover:bg-slate-50/60 active:scale-[0.99] active:bg-slate-50 dark:border-slate-600 dark:hover:border-slate-500 dark:hover:bg-slate-800/60 dark:active:bg-slate-800"
            }`}
          >
            <svg
              aria-hidden
              className={`mb-2 h-8 w-8 transition ${drag ? `scale-110 ${accent.dropIcon}` : "text-slate-400"}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5h10.5A2.25 2.25 0 0020 17.25v-10.5A2.25 2.25 0 0017.75 4.5H6.75A2.25 2.25 0 004.5 6.75v10.5A2.25 2.25 0 006.75 19.5z"
              />
            </svg>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
              Drag & drop or click to browse
            </p>
            <p className="mt-1 text-xs text-slate-400">.xlsx, .xls or .csv</p>
          </div>
        )
      ) : (
        analysis && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
              <span className="flex min-w-0 items-center gap-2">
                <svg
                  aria-hidden
                  className="h-4 w-4 shrink-0 text-emerald-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="truncate font-medium text-slate-700 dark:text-slate-200">
                  {state.parsed.fileName}
                </span>
              </span>
              <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                {analysis.dataRowCount.toLocaleString()} data rows
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Select
                label="Sheet"
                value={state.sheetIdx}
                onChange={(v) => onUpdate(side, { sheetIdx: v })}
                options={state.parsed.sheets.map((s, i) => ({
                  value: i,
                  label: s.name,
                }))}
              />
              <Select
                label="Header row"
                value={state.headerRow}
                onChange={(v) => onUpdate(side, { headerRow: v })}
                options={Array.from({ length: 20 }, (_, i) => ({
                  value: i,
                  label: `Row ${i + 1}`,
                }))}
              />
              <Select
                label="Name column"
                value={state.nameCol}
                onChange={(v) => onUpdate(side, { nameCol: v })}
                options={analysis.columns.map((c) => ({
                  value: c.index,
                  label: c.label,
                }))}
              />
              <Select
                label="Price column"
                value={state.priceCol}
                onChange={(v) => onUpdate(side, { priceCol: v })}
                options={analysis.columns.map((c) => ({
                  value: c.index,
                  label: c.label,
                }))}
              />
              <Select
                label="Qty column"
                value={state.qtyCol === null ? -1 : state.qtyCol}
                onChange={(v) => onUpdate(side, { qtyCol: v === -1 ? null : v })}
                options={[
                  { value: -1, label: "None" },
                  ...analysis.columns.map((c) => ({
                    value: c.index,
                    label: c.label,
                  })),
                ]}
              />
            </div>

            <PreviewTable analysis={analysis} state={state} accent={accent} />

            {health && <HealthPanel health={health} />}

            {state.error && (
              <p
                role="alert"
                className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
              >
                {state.error}
              </p>
            )}
          </div>
        )
      )}
      {/* Read errors must be visible in the dropzone state too — a bad file
          should never look like a dead click. */}
      {state.error && !state.parsed && (
        <p
          role="alert"
          className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
        >
          {state.error}
        </p>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div
      role="status"
      className="flex h-44 flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-800/40"
    >
      <svg
        aria-hidden
        className="h-7 w-7 animate-spin text-indigo-500"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-90"
          fill="currentColor"
          d="M4 12a8 8 0 018-8v2a6 6 0 00-6 6H4z"
        />
      </svg>
      <p className="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400">Reading file…</p>
      <div className="mt-3 h-1.5 w-36 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div className="h-full w-1/2 animate-pulse rounded-full bg-indigo-400" />
      </div>
      <span className="sr-only">Loading spreadsheet</span>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  options: { value: number; label: string }[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none transition hover:border-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:border-slate-600 dark:focus:ring-indigo-900/40"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function PreviewTable({
  analysis,
  state,
  accent,
}: {
  analysis: AnalyzedSheet;
  state: SideState;
  accent: Accent;
}) {
  const maxCols = 8;
  const cols = analysis.columns.slice(0, maxCols);
  const hidden = analysis.columns.length - cols.length;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200 dark:ring-slate-800">
        <table className="min-w-full border-collapse text-left text-xs">
          <thead>
            <tr>
              {cols.map((c) => {
                const isName = c.index === state.nameCol;
                const isPrice = c.index === state.priceCol;
                return (
                  <th
                    key={c.index}
                    className={`whitespace-nowrap px-2.5 py-2 font-semibold ${
                      isName
                        ? accent.nameHead
                        : isPrice
                          ? accent.priceHead
                          : "bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    }`}
                  >
                    <span className="line-clamp-1 max-w-[10rem]">{c.label}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {analysis.previewRows.map((row, i) => (
              <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                {cols.map((c) => {
                  const v = row?.[c.index];
                  const text =
                    v === null || v === undefined ? "" : String(v).trim();
                  return (
                    <td
                      key={c.index}
                      className="max-w-[10rem] truncate whitespace-nowrap px-2.5 py-1.5 text-slate-600 dark:text-slate-300"
                      title={text}
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {hidden > 0 && (
          <p className="border-t border-slate-100 px-2.5 py-1.5 text-[11px] text-slate-400 dark:border-slate-800">
            +{hidden} more column{hidden > 1 ? "s" : ""} (use the dropdowns above
            to reach them)
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={`h-2.5 w-2.5 rounded-sm ${accent.nameDot}`}
          />
          Name column
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={`h-2.5 w-2.5 rounded-sm ${accent.priceDot}`}
          />
          Price column
        </span>
        <span className="text-slate-400">
          highlighted in the preview header
        </span>
      </div>
    </div>
  );
}

// ---- Health check panel ----------------------------------------------------

type BadgeTone = "slate" | "emerald" | "amber" | "rose";

const BADGE_TONES: Record<BadgeTone, string> = {
  slate: "bg-white/70 text-slate-600 ring-slate-200 dark:bg-slate-800/70 dark:text-slate-300 dark:ring-slate-700",
  emerald:
    "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800",
  amber: "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800",
  rose: "bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:ring-rose-800",
};

function plu(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

function HealthBadge({
  tone,
  title,
  children,
}: {
  tone: BadgeTone;
  title: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

function HealthPanel({ health }: { health: FileHealth }) {
  const [open, setOpen] = useState(false);
  const p = health.price;

  const tone =
    health.verdict === "looks good"
      ? {
          box: "bg-emerald-50 ring-emerald-200 dark:bg-emerald-900/20 dark:ring-emerald-800",
          dot: "bg-emerald-500",
          text: "text-emerald-800 dark:text-emerald-300",
          hint: "text-emerald-700 dark:text-emerald-400",
          readable: "emerald" as BadgeTone,
        }
      : health.verdict === "warnings"
        ? {
            box: "bg-amber-50 ring-amber-200 dark:bg-amber-900/20 dark:ring-amber-800",
            dot: "bg-amber-500",
            text: "text-amber-800 dark:text-amber-300",
            hint: "text-amber-700 dark:text-amber-400",
            readable: (p.readablePercent >= 95 ? "emerald" : "amber") as BadgeTone,
          }
        : {
            box: "bg-rose-50 ring-rose-200 dark:bg-rose-900/20 dark:ring-rose-800",
            dot: "bg-rose-500",
            text: "text-rose-800 dark:text-rose-300",
            hint: "text-rose-700 dark:text-rose-400",
            readable: "rose" as BadgeTone,
          };

  // Sample problem rows for the expandable section (row number + reason).
  const details: string[] = [];
  details.push(
    `Header row ${health.headerInfo.headerRow} · Name: "${health.headerInfo.nameColLabel}" · Price: "${health.headerInfo.priceColLabel}"`,
  );
  details.push(
    health.codePattern.example
      ? `${health.codePattern.note} Example: "${health.codePattern.example.raw}" → "${health.codePattern.example.stripped}".`
      : health.codePattern.note,
  );

  for (const s of health.blankNameRows.samples) {
    details.push(
      `Row ${s.rowNum} — name is blank${s.raw ? ` (row has data: "${s.raw}")` : ""}`,
    );
  }
  if (health.blankNameRows.count > health.blankNameRows.samples.length) {
    details.push(
      `… +${(health.blankNameRows.count - health.blankNameRows.samples.length).toLocaleString()} more blank-name rows`,
    );
  }

  for (const s of p.unreadableSamples) {
    details.push(`Row ${s.rowNum} — price "${s.raw}" could not be read as a number`);
  }
  if (p.unreadableCount > p.unreadableSamples.length) {
    details.push(
      `… +${(p.unreadableCount - p.unreadableSamples.length).toLocaleString()} more unreadable prices`,
    );
  }

  for (const s of p.dateLikeSamples) {
    details.push(
      `Row ${s.rowNum} — price ${s.raw} is a whole number in the Excel date-serial range`,
    );
  }
  if (p.suspiciousDateLikeCount > p.dateLikeSamples.length) {
    details.push(
      `… +${(p.suspiciousDateLikeCount - p.dateLikeSamples.length).toLocaleString()} more date-like prices`,
    );
  }

  for (const d of health.duplicateDescriptions.samples) {
    const rows =
      d.rowSamples.join(", ") +
      (d.count > d.rowSamples.length ? ", …" : "");
    details.push(
      `"${d.name}" — appears ${d.count.toLocaleString()} times (rows ${rows})`,
    );
  }
  if (
    health.duplicateDescriptions.count >
    health.duplicateDescriptions.samples.length
  ) {
    details.push(
      `… +${(health.duplicateDescriptions.count - health.duplicateDescriptions.samples.length).toLocaleString()} more duplicated names`,
    );
  }

  for (const s of p.zeroSamples) {
    details.push(`Row ${s.rowNum} — price is 0`);
  }
  if (p.zeroPriceCount > p.zeroSamples.length) {
    details.push(
      `… +${(p.zeroPriceCount - p.zeroSamples.length).toLocaleString()} more zero prices`,
    );
  }

  for (const s of p.negativeSamples) {
    details.push(`Row ${s.rowNum} — price is ${s.raw}`);
  }
  if (p.negativeCount > p.negativeSamples.length) {
    details.push(
      `… +${(p.negativeCount - p.negativeSamples.length).toLocaleString()} more negative prices`,
    );
  }

  for (const s of p.textPriceSamples) {
    details.push(
      `Row ${s.rowNum} — price "${s.raw}" is stored as text (still parses)`,
    );
  }

  return (
    <section
      aria-label="File health check"
      className={`rounded-xl p-3 ring-1 ${tone.box}`}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone.dot}`}
        />
        <p className={`text-sm font-medium leading-snug ${tone.text}`}>
          {health.summary}
        </p>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <HealthBadge
          tone={tone.readable}
          title="Share of rows whose price cell parses to a number"
        >
          {p.readablePercent}% prices readable
        </HealthBadge>
        {p.unreadableCount > 0 && (
          <HealthBadge
            tone={p.readablePercent < 80 ? "rose" : "amber"}
            title="Cells that could not be read as a number (e.g. N/A)"
          >
            {plu(p.unreadableCount, "unreadable price")}
          </HealthBadge>
        )}
        {p.missingPriceCount > 0 && (
          <HealthBadge tone="slate" title="Rows with a blank price cell">
            {plu(p.missingPriceCount, "missing price")}
          </HealthBadge>
        )}
        {health.blankNameRows.count > 0 && (
          <HealthBadge
            tone="amber"
            title="Rows with data but no name in the name column"
          >
            {plu(health.blankNameRows.count, "blank name")}
          </HealthBadge>
        )}
        {health.duplicateDescriptions.count > 0 && (
          <HealthBadge tone="amber" title="Names that appear more than once">
            {plu(health.duplicateDescriptions.count, "duplicate name")}
          </HealthBadge>
        )}
        {p.suspiciousDateLikeCount > 0 && (
          <HealthBadge
            tone="amber"
            title="Whole numbers in the Excel date-serial range (20000-60000)"
          >
            {p.suspiciousDateLikeCount.toLocaleString()} possible date-as-price
          </HealthBadge>
        )}
        {p.zeroPriceCount > 0 && (
          <HealthBadge tone="amber" title="Prices that parse to exactly 0">
            {plu(p.zeroPriceCount, "zero price")}
          </HealthBadge>
        )}
        {p.negativeCount > 0 && (
          <HealthBadge tone="amber" title="Prices below zero">
            {plu(p.negativeCount, "negative price")}
          </HealthBadge>
        )}
        {p.textPriceCount > 0 && (
          <HealthBadge
            tone="slate"
            title="Prices stored as text — they still parse correctly"
          >
            {p.textPriceCount.toLocaleString()} text-stored prices
          </HealthBadge>
        )}
        <HealthBadge tone="slate" title={health.codePattern.note}>
          {health.codePattern.label}
        </HealthBadge>
      </div>

      {health.hints.length > 0 && (
        <p className={`mt-2 text-xs leading-relaxed ${tone.hint}`}>
          What this means: {health.hints.join(" ")}
        </p>
      )}

      <div className="mt-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={`text-xs font-semibold transition hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 ${tone.text}`}
        >
          {open ? "Hide details" : "Show details"}
        </button>
        {open && (
          <ul className="mt-1.5 max-h-48 space-y-1 overflow-y-auto pr-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
            {details.map((d, i) => (
              <li key={i} className="break-words">
                {d}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
