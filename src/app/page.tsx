"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { analyzeSheet, readWorkbook } from "@/lib/parse";
import type { Candidate, MatchResult, Settings, Status } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";
import type { EngineInputRow } from "@/lib/matching";
import UploadScreen, { EMPTY_SIDE } from "@/components/UploadScreen";
import type { SideState } from "@/components/UploadScreen";
import Dashboard, { type RunStats } from "@/components/Dashboard";
import type { JevDecision, JevPair } from "@/lib/jev";
import { runMatchingParallel, type ParallelRunHandle } from "@/lib/runParallel";
import ThemeToggle from "@/components/ThemeToggle";
import { cleanPrice } from "@/lib/normalize";
import {
  buildADuplicates,
  buildRowData,
  type AnalysisExtras,
} from "@/lib/analysis";

/** Label keywords that suggest a quantity column. */
const QTY_LABEL = /qty|quantity|pcs|pieces|units|sacks|boxes|dozen/i;

type Side = "A" | "B";
type Stage = "upload" | "running" | "results";

const STEP_LABELS = ["Upload files", "Compare", "Review results"] as const;

export default function Home() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("upload");
  const [sideA, setSideA] = useState<SideState>(EMPTY_SIDE);
  const [sideB, setSideB] = useState<SideState>(EMPTY_SIDE);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [fileNames, setFileNames] = useState<{ a: string; b: string } | null>(null);
  const [aQty, setAQty] = useState<Record<number, number | null>>({});
  const [bQty, setBQty] = useState<Record<number, number | null>>({});
  const [aDups, setADups] = useState<Record<number, number[]>>({});
  const [bRowData, setBRowData] = useState<AnalysisExtras["bRows"]>({});
  const [depreciationPct, setDepreciationPct] = useState(0);
  const [runError, setRunError] = useState<string | null>(null);
  const runRef = useRef<ParallelRunHandle | null>(null);

  const analysisA = useMemo(
    () =>
      sideA.parsed
        ? analyzeSheet(sideA.parsed.sheets[sideA.sheetIdx], sideA.headerRow)
        : null,
    [sideA],
  );
  const analysisB = useMemo(
    () =>
      sideB.parsed
        ? analyzeSheet(sideB.parsed.sheets[sideB.sheetIdx], sideB.headerRow)
        : null,
    [sideB],
  );

  const handleFile = useCallback(async (side: Side, file: File) => {
    const set = side === "A" ? setSideA : setSideB;
    set((s) => ({ ...s, loading: true, error: null }));
    try {
      const parsed = await readWorkbook(file);
      if (parsed.sheets.length === 0) throw new Error("no sheets found");
      const first = analyzeSheet(parsed.sheets[0]);
      const qtyCol =
        first.columns.find((c) => QTY_LABEL.test(c.label))?.index ?? null;
      set({
        parsed,
        sheetIdx: 0,
        headerRow: first.headerRow,
        nameCol: first.mapping.nameCol,
        priceCol: first.mapping.priceCol,
        qtyCol,
        codeCol: first.mapping.codeCol,
        loading: false,
        error: null,
      });
    } catch (err) {
      set((s) => ({
        ...s,
        loading: false,
        error: `Could not read this file (${(err as Error).message}).`,
      }));
    }
  }, []);

  const handleUpdate = useCallback((side: Side, patch: Partial<SideState>) => {
    const set = side === "A" ? setSideA : setSideB;
    set((s) => {
      const next = { ...s, ...patch };
      if (!s.parsed) return next;
      if (patch.sheetIdx !== undefined) {
        const a = analyzeSheet(s.parsed.sheets[patch.sheetIdx]);
        next.headerRow = a.headerRow;
        next.nameCol = a.mapping.nameCol;
        next.priceCol = a.mapping.priceCol;
        next.qtyCol = a.columns.find((c) => QTY_LABEL.test(c.label))?.index ?? null;
        next.codeCol = a.mapping.codeCol;
      } else if (patch.headerRow !== undefined) {
        const a = analyzeSheet(s.parsed.sheets[next.sheetIdx], patch.headerRow);
        const width = a.columns.length;
        next.nameCol = Math.min(s.nameCol, width - 1);
        next.priceCol = Math.min(s.priceCol, width - 1);
        if (next.qtyCol !== null) next.qtyCol = Math.min(next.qtyCol, width - 1);
        if (next.codeCol !== null) next.codeCol = Math.min(next.codeCol, width - 1);
      }
      return next;
    });
  }, []);

  const handleClear = useCallback((side: Side) => {
    (side === "A" ? setSideA : setSideB)(EMPTY_SIDE);
    setResults(null);
    setStats(null);
  }, []);

  const canRun = Boolean(
    analysisA &&
      analysisB &&
      sideA.parsed &&
      sideB.parsed &&
      sideA.nameCol !== sideA.priceCol &&
      sideB.nameCol !== sideB.priceCol &&
      (analysisA?.dataRowCount ?? 0) > 0 &&
      (analysisB?.dataRowCount ?? 0) > 0,
  );

  const handleRun = useCallback(
    (override?: Settings) => {
      // Guard against event objects: only a real Settings shape may override.
      const runSettings =
        override &&
        typeof override === "object" &&
        typeof (override as Settings).reviewFloor === "number"
          ? override
          : settings;
      if (!sideA.parsed || !sideB.parsed) return;
      const aRows = buildEngineRows(
        sideA.parsed,
        sideA.sheetIdx,
        sideA.headerRow,
        sideA.nameCol,
        sideA.priceCol,
        sideA.codeCol,
      );
      const bRows = buildEngineRows(
        sideB.parsed,
        sideB.sheetIdx,
        sideB.headerRow,
        sideB.nameCol,
        sideB.priceCol,
        sideB.codeCol,
      );
      if (aRows.length === 0 || bRows.length === 0) {
        setRunError(
          "One of the files produced 0 data rows — check the header row and column mapping.",
        );
        return;
      }
    setRunError(null);
    setFileNames({ a: sideA.parsed.fileName, b: sideB.parsed.fileName });
    setAQty(buildQtyMap(sideA.parsed, sideA.sheetIdx, sideA.headerRow, sideA.qtyCol));
    setBQty(buildQtyMap(sideB.parsed, sideB.sheetIdx, sideB.headerRow, sideB.qtyCol));
    setADups(buildADuplicates(sideA.parsed.sheets[sideA.sheetIdx]?.rows ?? [], sideA.headerRow, sideA.nameCol));
    setBRowData(
      buildRowData(
        sideB.parsed.sheets[sideB.sheetIdx]?.rows ?? [],
        sideB.headerRow,
        sideB.nameCol,
        sideB.priceCol,
        sideB.qtyCol,
        sideB.codeCol,
      ),
    );
    setStage("running");
    setProgress({ done: 0, total: aRows.length });

      // Fan the A rows out across one worker per CPU core — each chunk is
      // matched against the full File B; results come back in original order.
      runRef.current = runMatchingParallel(
        aRows,
        bRows,
        runSettings,
        (done, total) => setProgress({ done, total }),
        (results, parallelStats) => {
          setResults(results);
          setStats(parallelStats);
          runRef.current = null;
          setStage("results");
        },
        (message) => {
          setRunError(`Matching engine error: ${message}`);
          runRef.current = null;
          setStage("upload");
        },
      );
    },
    [sideA, sideB, settings],
  );

  /**
   * Manual pick = the human asserts identity. The row upgrades to CONFIRMED
   * (method "manual") regardless of its previous classification — fuzzy leads,
   * conflicts and unmatched rows are all resolvable this way. The picked
   * record becomes the reference for the difference display.
   */
  const handlePick = useCallback(
    (id: number, c: Candidate) => {
      setResults((rs) => {
        const mapped = rs?.map((r) => {
          if (r.id !== id) return r;
          const difference =
            c.price !== null && r.aPrice !== null
              ? Math.round((c.price - r.aPrice) * 100) / 100
              : null;
          const inSet = r.candidates.some((x) => x.bRowNum === c.bRowNum);
          return {
            ...r,
            chosen: c,
            bPrice: c.price,
            difference,
            method: "manual" as const,
            score: c.similarity,
            status: "CONFIRMED" as Status,
            candidates: inSet ? r.candidates : [...r.candidates, c],
            notes: [
              ...r.notes.filter((n) => !n.startsWith("Manually")),
              `Manually confirmed — File B row ${c.bRowNum}.`,
            ],
          };
        });
        return mapped ?? null;
      });
    },
    [],
  );

  /** Depreciation only affects valuation flags at render time — no re-apply. */
  const handleDepreciationChange = useCallback((pct: number) => {
    setDepreciationPct(pct);
  }, []);

  /**
   * Apply Jev (System One) verdicts to the results.
   *  MATCH     → CONFIRMED with method "jev" (identity established; pricing
   *              stays a separate valuation question).
   *  NOT_MATCH → UNMATCHED, chosen cleared, note "Jev-rejected" (candidates
   *              stay listed so the user can still override manually).
   *  UNCERTAIN → stays PROBABLE/CONFLICT, note "Jev uncertain (…)".
   * Guards: only rows still sitting in PROBABLE or CONFLICT are touched — ids
   * are reused across runs, so a decision in flight during a re-run must never
   * land on a row that already left the review bucket.
   */
  const handleJevApply = useCallback(
    (decisions: JevDecision[], pairs: JevPair[]) => {
      if (decisions.length === 0) return;
      const byId = new Map(decisions.map((d) => [d.id, d]));
      const pairById = new Map(pairs.map((p) => [p.id, p]));
      setResults((rs) => {
        if (!rs) return rs;
        return rs.map((r) => {
          const d = byId.get(r.id);
          if (!d || (r.status !== "PROBABLE" && r.status !== "CONFLICT")) return r;
          // Replace any previous Jev note so re-screening doesn't duplicate them.
          const otherNotes = r.notes.filter((n) => !n.startsWith("Jev"));
          if (d.verdict === "MATCH") {
            const pair = pairById.get(r.id);
            const cand =
              r.chosen ??
              (pair
                ? (r.candidates.find((c) => c.rawName === pair.bName) ??
                  r.candidates[0] ??
                  null)
                : null);
            const bPrice = cand?.price ?? null;
            const difference =
              bPrice !== null && r.aPrice !== null
                ? Math.round((bPrice - r.aPrice) * 100) / 100
                : null;
            return {
              ...r,
              chosen: cand ?? r.chosen,
              bPrice,
              difference,
              method: "jev" as const,
              status: "CONFIRMED" as Status,
              jevVerdict: "MATCH" as const,
              jevConfidence: d.confidence,
              notes: [...otherNotes, `Jev-verified (confidence ${d.confidence}%).`],
            };
          }
          if (d.verdict === "NOT_MATCH") {
            return {
              ...r,
              status: "UNMATCHED" as Status,
              method: null,
              score: null,
              chosen: null,
              bPrice: null,
              difference: null,
              jevVerdict: "NOT_MATCH" as const,
              jevConfidence: d.confidence,
              notes: [...otherNotes, "Jev-rejected."],
            };
          }
          return {
            ...r,
            jevVerdict: "UNCERTAIN" as const,
            jevConfidence: d.confidence,
            notes: [
              ...otherNotes,
              `Jev uncertain (confidence ${d.confidence}%) — manual review.`,
            ],
          };
        });
      });
    },
    [],
  );

  function startOver() {
    runRef.current?.cancel();
    runRef.current = null;
    setStage("upload");
    setResults(null);
    setStats(null);
    setProgress(null);
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  const activeStep = stage === "upload" ? 0 : stage === "running" ? 1 : 2;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white">
            PV
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight text-slate-900 dark:text-slate-50">
              Price Verifier
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Identity-first reconciliation — all in your browser
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <ol className="hidden items-center gap-2 text-xs sm:flex">
            {STEP_LABELS.map((label, i) => (
              <li
                key={label}
                className={`flex items-center gap-1.5 ${
                  i === activeStep
                    ? "font-semibold text-slate-900 dark:text-slate-50"
                    : i < activeStep
                      ? "text-emerald-600"
                      : "text-slate-400"
                }`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                    i === activeStep
                      ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                      : i < activeStep
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-200 text-slate-500"
                  }`}
                >
                  {i < activeStep ? "✓" : i + 1}
                </span>
                {label}
              </li>
            ))}
          </ol>
          <ThemeToggle />
          <button
            onClick={signOut}
            className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Sign out
          </button>
        </div>
      </header>

      {stage !== "results" ? (
        <UploadScreen
          sideA={sideA}
          sideB={sideB}
          analysisA={analysisA}
          analysisB={analysisB}
          onFile={handleFile}
          onUpdate={handleUpdate}
          onClear={handleClear}
          onRun={() => handleRun()}
          canRun={canRun}
          busy={stage === "running"}
          progress={progress}
          runError={runError}
        />
      ) : (
        results &&
        stats && (
          <Dashboard
            results={results}
            stats={stats}
            settings={settings}
            fileNames={fileNames}
            aQty={aQty}
            bQty={bQty}
            aDups={aDups}
            bRowData={bRowData}
            depreciationPct={depreciationPct}
            onDepreciationChange={handleDepreciationChange}
            busy={false}
            onSettingsChange={setSettings}
            onRerun={handleRun}
            onPick={handlePick}
            onJevApply={handleJevApply}
            onBack={startOver}
          />
        )
      )}
    </main>
  );
}

function buildEngineRows(
  parsed: NonNullable<SideState["parsed"]>,
  sheetIdx: number,
  headerRow: number,
  nameCol: number,
  priceCol: number,
  codeCol: number | null,
): EngineInputRow[] {
  const rows = parsed.sheets[sheetIdx]?.rows ?? [];
  const out: EngineInputRow[] = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const name = row[nameCol];
    if (name === null || name === undefined || String(name).trim() === "")
      continue;
    out.push({
      rowNum: r + 1,
      rawName: name,
      rawPrice: row[priceCol] ?? null,
      rawCode: codeCol === null ? null : (row[codeCol] ?? null),
    });
  }
  return out;
}

/** rowNum -> parsed quantity from the optional qty column ({} when unmapped). */
function buildQtyMap(
  parsed: NonNullable<SideState["parsed"]>,
  sheetIdx: number,
  headerRow: number,
  qtyCol: number | null,
): Record<number, number | null> {
  if (qtyCol === null) return {};
  const rows = parsed.sheets[sheetIdx]?.rows ?? [];
  const map: Record<number, number | null> = {};
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const raw = row[qtyCol];
    if (raw === null || raw === undefined || String(raw).trim() === "") continue;
    map[r + 1] = cleanPrice(raw);
  }
  return map;
}
