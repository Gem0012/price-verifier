import type { MatchResult } from "./types.ts";
import { cleanPrice, normalizeDescription } from "./normalize.ts";

// ---- Claim-side analysis helpers (pure, UI/report layer) --------------------
// Quantities, extended amounts, duplicates and depreciation are derived here
// from the raw parsed rows and match results — the matching engine itself
// stays untouched.

export type RowNum = number;
export interface BRowData {
  name: string;
  price: number | null;
  qty: number | null;
}
export interface AnalysisExtras {
  aQty: Record<RowNum, number | null>;
  bQty: Record<RowNum, number | null>;
  /** rowNum -> other rowNums in File A with the same cleaned description */
  aDups: Record<RowNum, RowNum[]>;
  /** File B rows keyed by rowNum (for reverse-coverage reporting) */
  bRows: Record<RowNum, BRowData>;
}

export const hasEntries = (m: Record<string, unknown>) => Object.keys(m).length > 0;

/** Extended amount: qty × price, or null when either side is missing. */
export function extAmount(qty: number | null, price: number | null): number | null {
  return qty !== null && price !== null ? Math.round(qty * price * 100) / 100 : null;
}

/**
 * Rows from one parsed sheet: rowNum -> { name, price, qty } using the
 * chosen columns. Used for reverse coverage (adjuster lines no claim row
 * matched) and extended amounts.
 */
export function buildRowData(
  rows: unknown[][],
  headerRow: number,
  nameCol: number,
  priceCol: number,
  qtyCol: number | null,
): Record<RowNum, BRowData> {
  const out: Record<RowNum, BRowData> = {};
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const name = row[nameCol];
    if (name === null || name === undefined || String(name).trim() === "") continue;
    out[r + 1] = {
      name: String(name).trim(),
      price: cleanPrice(row[priceCol] ?? null),
      qty: qtyCol === null ? null : cleanPrice(row[qtyCol] ?? null),
    };
  }
  return out;
}

/**
 * Duplicate claim lines: File A rows whose cleaned description appears on
 * more than one row (double-dipping signal). Returns rowNum -> other rowNums.
 */
export function buildADuplicates(
  rows: unknown[][],
  headerRow: number,
  nameCol: number,
): Record<RowNum, RowNum[]> {
  const byClean = new Map<string, RowNum[]>();
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const name = row[nameCol];
    if (name === null || name === undefined || String(name).trim() === "") continue;
    const cleaned = normalizeDescription(String(name));
    if (!cleaned) continue;
    const arr = byClean.get(cleaned);
    if (arr) arr.push(r + 1);
    else byClean.set(cleaned, [r + 1]);
  }
  const dups: Record<RowNum, RowNum[]> = {};
  for (const rowNums of byClean.values()) {
    if (rowNums.length < 2) continue;
    for (const rn of rowNums) {
      dups[rn] = rowNums.filter((x) => x !== rn);
    }
  }
  return dups;
}

const ALLOWANCE_NOTE = /Verified below claim by [\d.]+% — within the depreciation allowance \(([\d.]+)%\)\./;

/**
 * Depreciation allowance: when the adjuster applied ACV, verified prices are
 * EXPECTED to sit below the claim. Rows where the verified price is below the
 * claim by at most depreciationPct% are re-classified to MATCH with an
 * explanatory note (upward gaps are never affected).
 * Reversible: rows previously allowed under a HIGHER pct are reverted when the
 * allowance shrinks, so the displayed results always follow the setting.
 */
export function applyDepreciationAllowance(
  results: MatchResult[],
  depreciationPct: number,
): MatchResult[] {
  const revert = (r: MatchResult): MatchResult => {
    const stale = r.notes.find((n) => {
      const m = ALLOWANCE_NOTE.exec(n);
      return m && Number(m[1]) > depreciationPct;
    });
    if (!stale) return r;
    return {
      ...r,
      status: "MISMATCH" as const,
      notes: r.notes.filter((n) => n !== stale),
    };
  };

  if (!depreciationPct || depreciationPct <= 0) {
    return results.map((r) =>
      r.status === "MATCH" && r.notes.some((n) => ALLOWANCE_NOTE.test(n)) ? revert(r) : r,
    );
  }

  return results.map((r) => {
    let row = r.status === "MATCH" ? revert(r) : r;
    if (row.status !== "MISMATCH") return row;
    if (row.bPrice === null || row.aPrice === null || row.aPrice === 0) return row;
    if (row.bPrice >= row.aPrice) return row; // only downward gaps are depreciation-shaped
    const gapPct = ((row.aPrice - row.bPrice) / row.aPrice) * 100;
    if (gapPct > depreciationPct) return row;
    const note = `Verified below claim by ${gapPct.toFixed(1)}% — within the depreciation allowance (${depreciationPct}%). Expected for ACV-style assessment.`;
    if (row.notes.some((n) => ALLOWANCE_NOTE.test(n))) {
      row = { ...row, notes: row.notes.map((n) => (ALLOWANCE_NOTE.test(n) ? note : n)) };
    } else {
      row = { ...row, notes: [...row.notes, note] };
    }
    return { ...row, status: "MATCH" as const };
  });
}

/** B rowNums claimed by at least one match decision (chosen or Jev-verified). */
export function claimedBRowNums(results: MatchResult[]): Set<RowNum> {
  const set = new Set<RowNum>();
  for (const r of results) {
    if (r.chosen) set.add(r.chosen.bRowNum);
  }
  return set;
}

export interface UnmatchedBLine {
  rowNum: RowNum;
  name: string;
  price: number | null;
  qty: number | null;
  extended: number | null;
}

/** Adjuster lines no claim row was matched to — the reverse-coverage view. */
export function unmatchedBLines(
  bRows: Record<RowNum, BRowData>,
  results: MatchResult[],
): UnmatchedBLine[] {
  const claimed = claimedBRowNums(results);
  const out: UnmatchedBLine[] = [];
  for (const [numStr, row] of Object.entries(bRows)) {
    const rowNum = Number(numStr);
    if (claimed.has(rowNum)) continue;
    out.push({
      rowNum,
      name: row.name,
      price: row.price,
      qty: row.qty,
      extended: extAmount(row.qty, row.price),
    });
  }
  return out.sort((x, y) => (y.extended ?? -1) - (x.extended ?? -1) || x.rowNum - y.rowNum);
}
