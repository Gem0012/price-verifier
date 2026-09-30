"use client";

import { useState } from "react";
import type { Candidate, MatchResult, Settings, Status } from "@/lib/types";
import type { EngineStats } from "@/lib/matching";
import ResultsTable from "./ResultsTable";
import ItemDetailModal from "./ItemDetailModal";
import SettingsPanel from "./SettingsPanel";
import PriceSummary from "./PriceSummary";
import AdjusterLedger from "./AdjusterLedger";
import { STATUS_NAMES } from "./StatusPill";
import { downloadReport } from "@/lib/export";
import { getJevKey, screenNeedsReview } from "@/lib/jev";
import type { JevDecision, JevPair } from "@/lib/jev";

export type RunStats = EngineStats & { resolvedCodeStrip: Settings["codeStrip"] };

interface Props {
  results: MatchResult[];
  stats: RunStats;
  settings: Settings;
  fileNames: { a: string; b: string } | null;
  aQty: Record<number, number | null>;
  bQty: Record<number, number | null>;
  /** rowNum -> other rowNums in File A sharing the same description (double-dipping flag) */
  aDups: Record<number, number[]>;
  /** All File B rows keyed by rowNum — powers the reverse-coverage report */
  bRowData: Record<number, { name: string; price: number | null; qty: number | null }>;
  /** Depreciation allowance (%) currently applied to displayed statuses */
  depreciationPct: number;
  onDepreciationChange: (pct: number) => void;
  busy: boolean;
  onSettingsChange: (s: Settings) => void;
  onRerun: (override?: Settings) => void;
  onPick: (id: number, c: Candidate) => void;
  onJevApply: (decisions: JevDecision[], pairs: JevPair[]) => void;
  onBack: () => void;
}

type Tab = "audit" | "ledger" | "action" | "summary" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "audit", label: "Claim Audit" },
  { id: "ledger", label: "Adjuster Ledger" },
  { id: "action", label: "Action List" },
  { id: "summary", label: "Price Summary" },
  { id: "settings", label: "Settings" },
];

export default function Dashboard({
  results,
  stats,
  settings,
  fileNames,
  aQty,
  bQty,
  aDups,
  bRowData,
  depreciationPct,
  onDepreciationChange,
  busy,
  onSettingsChange,
  onRerun,
  onPick,
  onJevApply,
  onBack,
}: Props) {
  const [tab, setTab] = useState<Tab>("audit");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [screening, setScreening] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [screenError, setScreenError] = useState<string | null>(null);

  const detail = detailId === null ? null : (results.find((r) => r.id === detailId) ?? null);
  // Live counts: statuses change as verdicts are applied (Jev) and rows are
  // picked manually, so derive the bucket counts from the current results.
  const liveCounts: Record<Status, number> = {
    MATCH: 0,
    MISMATCH: 0,
    MULTIPLE: 0,
    NEEDS_REVIEW: 0,
    NOT_FOUND: 0,
  };
  for (const r of results) liveCounts[r.status]++;
  const problems =
    liveCounts.MISMATCH + liveCounts.MULTIPLE + liveCounts.NEEDS_REVIEW + liveCounts.NOT_FOUND;
  const jevConnected = typeof window !== "undefined" && getJevKey() !== "";

  // Needs-review rows: Jev screens the pair even when no candidate was chosen
  // yet — the top candidate stands in (that is exactly the uncertain case).
  const needsReviewPairs: JevPair[] = [];
  for (const r of results) {
    if (r.status !== "NEEDS_REVIEW") continue;
    const c = r.chosen ?? r.candidates[0];
    if (c) {
      needsReviewPairs.push({
        id: r.id,
        aName: r.aRawName,
        bName: c.rawName,
      });
    }
  }

  async function runScreening(pairs: JevPair[]) {
    const key = getJevKey();
    if (!key) {
      setTab("settings");
      return;
    }
    setScreening({ done: 0, total: pairs.length });
    setScreenError(null);
    try {
      const decisions = await screenNeedsReview(pairs, key, (done, total) =>
        setScreening({ done, total }),
      );
      onJevApply(decisions, pairs);
    } catch (err) {
      setScreenError(`Jev screening failed: ${(err as Error).message}`);
    } finally {
      setScreening(null);
    }
  }

  async function handleScreenOne(id: number) {
    const r = results.find((x) => x.id === id);
    if (!r || r.status !== "NEEDS_REVIEW") return;
    const c = r.chosen ?? r.candidates[0];
    if (!c) return;
    await runScreening([{ id: r.id, aName: r.aRawName, bName: c.rawName }]);
  }

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      // Recompute counts from LIVE results — Jev verdicts and manual picks
      // change statuses after the run, and the Summary sheet must agree with
      // the audit sheets it ships alongside.
      const liveStats: RunStats = {
        ...stats,
        total: results.length,
        MATCH: liveCounts.MATCH,
        MISMATCH: liveCounts.MISMATCH,
        MULTIPLE: liveCounts.MULTIPLE,
        NEEDS_REVIEW: liveCounts.NEEDS_REVIEW,
        NOT_FOUND: liveCounts.NOT_FOUND,
      };
      await downloadReport(results, liveStats, settings, fileNames, {
        aQty,
        bQty,
        aDups,
        bRows: bRowData,
      });
    } catch (err) {
      setExportError(`Export failed: ${(err as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  const cards: { status: Status; count: number }[] = [
    { status: "MATCH", count: liveCounts.MATCH },
    { status: "MISMATCH", count: liveCounts.MISMATCH },
    { status: "MULTIPLE", count: liveCounts.MULTIPLE },
    { status: "NEEDS_REVIEW", count: liveCounts.NEEDS_REVIEW },
    { status: "NOT_FOUND", count: liveCounts.NOT_FOUND },
  ];

  return (
    <div className="space-y-5 pb-10">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-2xl bg-white dark:bg-slate-900 p-4 shadow-sm ring-1 ring-slate-200 dark:ring-slate-800">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">File A items</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">
            {stats.total.toLocaleString()}
          </p>
        </div>
        {cards.map((c) => (
          <button
            key={c.status}
            onClick={() => {
              setTab(c.status === "MATCH" ? "audit" : "action");
            }}
            className="text-left"
            title={`Show in ${c.status === "MATCH" ? "Full Audit" : "Action List"}`}
          >
            <StatusCard status={c.status} count={c.count} />
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl bg-white dark:bg-slate-900 p-1 shadow-sm ring-1 ring-slate-200 dark:ring-slate-800">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                tab === t.id
                  ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900"
                  : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              {t.label}
              {t.id === "action" && problems > 0 && (
                <span
                  className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    tab === t.id ? "bg-white dark:bg-slate-900/20 text-white" : "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-400"
                  }`}
                >
                  {problems.toLocaleString()}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50"
          >
            {exporting ? "Building…" : "⬇ Export Excel report"}
          </button>
          <button
            onClick={onBack}
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60"
          >
            Start over
          </button>
        </div>
      </div>

      {exportError && (
        <p className="rounded-xl bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-700 dark:text-rose-400 ring-1 ring-rose-200 dark:ring-rose-800">
          {exportError}
        </p>
      )}

      {screenError && (
        <p className="rounded-xl bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-700 dark:text-rose-400 ring-1 ring-rose-200 dark:ring-rose-800">
          {screenError}
        </p>
      )}

      {busy && (
        <p className="rounded-xl bg-indigo-50 dark:bg-indigo-950/40 px-4 py-3 text-sm text-indigo-800 dark:text-indigo-200 ring-1 ring-indigo-200 dark:ring-indigo-800">
          Re-running the comparison with the new settings…
        </p>
      )}

      {tab === "audit" && (
        <ResultsTable
          results={results}
          aQty={aQty}
          bQty={bQty}
          aDups={aDups}
          onOpen={setDetailId}
        />
      )}
      {tab === "ledger" && <AdjusterLedger bRowData={bRowData} results={results} />}
      {tab === "action" && (
        <>
          {needsReviewPairs.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white dark:bg-slate-900 px-4 py-3 shadow-sm ring-1 ring-slate-200 dark:ring-slate-800">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {jevConnected
                  ? "Jev (TypeSafe AI) can screen these uncertain matches for you."
                  : "Connect your TypeSafe AI key to let Jev screen these automatically — the app works fine without it."}
              </p>
              <button
                onClick={() =>
                  jevConnected ? void runScreening(needsReviewPairs) : setTab("settings")
                }
                disabled={screening !== null}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {screening !== null
                  ? `Screening ${screening.done}/${screening.total}…`
                  : jevConnected
                    ? `Screen ${needsReviewPairs.length.toLocaleString()} needs-review ${
                        needsReviewPairs.length === 1 ? "item" : "items"
                      } with Jev`
                    : "Connect Jev in Settings"}
              </button>
            </div>
          )}
          <ResultsTable
            results={results}
            problemsOnly
            aQty={aQty}
            bQty={bQty}
            aDups={aDups}
            onOpen={setDetailId}
          />
        </>
      )}
      {tab === "summary" && (
        <PriceSummary
          results={results}
          tolerancePct={settings.priceTolerance}
          aQty={aQty}
          bQty={bQty}
          aDups={aDups}
          bRowData={bRowData}
        />
      )}
      {tab === "settings" && (
        <SettingsPanel
          settings={settings}
          resolvedCodeStrip={stats.resolvedCodeStrip}
          depreciationPct={depreciationPct}
          onDepreciationChange={onDepreciationChange}
          onApply={(s) => {
            // Pass the new settings directly — calling onRerun() without them
            // would run with the pre-update closure's stale thresholds.
            onSettingsChange(s);
            onRerun(s);
          }}
        />
      )}

      <ItemDetailModal
        result={detail}
        jevConnected={jevConnected}
        screening={screening !== null}
        aQty={aQty}
        bQty={bQty}
        onClose={() => setDetailId(null)}
        onPick={onPick}
        onScreen={(id) => void handleScreenOne(id)}
        onOpenSettings={() => setTab("settings")}
      />
    </div>
  );
}

const CARD_STYLES: Record<Status, string> = {
  MATCH: "ring-emerald-200 dark:ring-emerald-800 hover:ring-emerald-400",
  MISMATCH: "ring-rose-200 dark:ring-rose-800 hover:ring-rose-400",
  MULTIPLE: "ring-orange-200 dark:ring-orange-800 hover:ring-orange-400",
  NEEDS_REVIEW: "ring-amber-200 dark:ring-amber-800 hover:ring-amber-400",
  NOT_FOUND: "ring-slate-200 dark:ring-slate-800 hover:ring-slate-400",
};
const CARD_TEXT: Record<Status, string> = {
  MATCH: "text-emerald-700 dark:text-emerald-400",
  MISMATCH: "text-rose-700 dark:text-rose-400",
  MULTIPLE: "text-orange-700",
  NEEDS_REVIEW: "text-amber-700",
  NOT_FOUND: "text-slate-600 dark:text-slate-300",
};

function StatusCard({ status, count }: { status: Status; count: number }) {
  return (
    <div
      className={`rounded-2xl bg-white dark:bg-slate-900 p-4 shadow-sm ring-1 transition ${CARD_STYLES[status]}`}
    >
      <p className={`text-xs font-medium ${CARD_TEXT[status]}`}>{STATUS_NAMES[status]}</p>
      <p className={`mt-1 text-2xl font-bold ${CARD_TEXT[status]}`}>
        {count.toLocaleString()}
      </p>
    </div>
  );
}
