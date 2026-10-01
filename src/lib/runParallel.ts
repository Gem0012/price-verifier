"use client";

import type { EngineInputRow } from "./matching.ts";
import type { MatchResult, Settings } from "./types.ts";

export interface ParallelRunStats {
  total: number;
  CONFIRMED: number;
  STRONG: number;
  PROBABLE: number;
  CONFLICT: number;
  UNMATCHED: number;
  resolvedCodeStrip: Settings["codeStrip"];
}

export interface ParallelRunHandle {
  cancel: () => void;
}

interface ChunkWorkerDone {
  type: "done";
  chunkIndex: number;
  results: MatchResult[];
  stats: {
    CONFIRMED: number;
    STRONG: number;
    PROBABLE: number;
    CONFLICT: number;
    UNMATCHED: number;
  };
  resolvedCodeStrip: Settings["codeStrip"];
}

function workerCountFor(aRows: number): number {
  const cores =
    typeof navigator !== "undefined" && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 4;
  // Below ~1,500 A rows the fan-out overhead (re-parsing B per worker) wins.
  const cap = aRows >= 1500 ? Math.min(cores, 8) : 1;
  return Math.max(1, cap);
}

/**
 * Runs the matching engine on all CPU cores: File A is split into contiguous
 * chunks, each chunk is matched against the full File B in its own worker,
 * and the ordered results are stitched back together. Row numbering and
 * statuses are identical to a single-worker run.
 */
export function runMatchingParallel(
  aRows: EngineInputRow[],
  bRows: EngineInputRow[],
  settings: Settings,
  onProgress: (done: number, total: number) => void,
  onDone: (results: MatchResult[], stats: ParallelRunStats) => void,
  onError: (message: string) => void,
): ParallelRunHandle {
  const chunkCount = workerCountFor(aRows.length);
  const chunkSize = Math.ceil(aRows.length / chunkCount);

  const workers: Worker[] = [];
  const results: MatchResult[][] = new Array(chunkCount);
  const perChunkStats = new Array(chunkCount);
  const doneCounts = new Array(chunkCount).fill(0);
  const totals = new Array(chunkCount).fill(0);
  let finished = 0;
  let cancelled = false;
  let resolvedCodeStrip: Settings["codeStrip"] | null = null;

  const terminateAll = () => {
    for (const w of workers) w.terminate();
    workers.length = 0;
  };

  const maybeFinish = () => {
    if (cancelled || finished < chunkCount) return;
    // Chunk-local ids restart at 0 — renumber to global row order so detail
    // lookups, manual picks and Jev decisions keep addressing the right row.
    let globalIdx = 0;
    const flat: MatchResult[] = [];
    for (const chunk of results) {
      if (!chunk) continue;
      for (const r of chunk) {
        flat.push(r.id === globalIdx ? r : { ...r, id: globalIdx });
        globalIdx++;
      }
    }
    const stats: ParallelRunStats = {
      total: flat.length,
      CONFIRMED: 0,
      STRONG: 0,
      PROBABLE: 0,
      CONFLICT: 0,
      UNMATCHED: 0,
      resolvedCodeStrip: resolvedCodeStrip ?? settings.codeStrip,
    };
    for (const s of perChunkStats) {
      stats.CONFIRMED += s.CONFIRMED;
      stats.STRONG += s.STRONG;
      stats.PROBABLE += s.PROBABLE;
      stats.CONFLICT += s.CONFLICT;
      stats.UNMATCHED += s.UNMATCHED;
    }
    terminateAll();
    onDone(flat, stats);
  };

  for (let i = 0; i < chunkCount; i++) {
    const chunk = aRows.slice(i * chunkSize, (i + 1) * chunkSize);
    if (chunk.length === 0) {
      finished++;
      continue;
    }
    const worker = new Worker(new URL("../workers/match.worker.ts", import.meta.url));
    workers.push(worker);
    const localIndex = workers.length - 1;
    worker.onmessage = (e: MessageEvent) => {
      if (cancelled) return;
      const msg = e.data;
      if (msg.type === "progress") {
        doneCounts[i] = msg.done;
        totals[i] = msg.total;
        onProgress(
          doneCounts.reduce((a, b) => a + b, 0),
          aRows.length,
        );
      } else if (msg.type === "done") {
        results[i] = msg.results;
        perChunkStats[i] = msg.stats;
        if (!resolvedCodeStrip) resolvedCodeStrip = msg.resolvedCodeStrip;
        finished++;
        maybeFinish();
      }
    };
    worker.onerror = (err) => {
      if (cancelled) return;
      cancelled = true;
      terminateAll();
      onError(err.message || "worker crashed");
    };
    worker.postMessage({ type: "start", aRows: chunk, bRows, settings });
  }
  if (chunkCount > workers.length) maybeFinish();

  return {
    cancel: () => {
      cancelled = true;
      terminateAll();
    },
  };
}
