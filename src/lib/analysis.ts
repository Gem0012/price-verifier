import type { MatchResult, Status } from "./types.ts";
import { cleanPrice, normalizeDescription } from "./normalize.ts";

// ---- Valuation layer (three-layer model, layer 3: valuation) ---------------
// Identity was decided by the matching engine (part numbers / descriptions).
// This layer never decides identity — it collects the costing EVIDENCE for
// every identified item: all matching costing records, their price range and
// a weighted average, so the adjuster can set an accepted cost on a documented
// basis. Prices are explained, not matched.

export type RowNum = number;
export interface BRowData {
  name: string;
  price: number | null;
  qty: number | null;
  code?: string | null;
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
 * Rows from one parsed sheet: rowNum -> { name, price, qty, code } using the
 * chosen columns. Used for reverse coverage (costing lines no claim row
 * matched), extended amounts and the identity keys of File B.
 */
export function buildRowData(
  rows: unknown[][],
  headerRow: number,
  nameCol: number,
  priceCol: number,
  qtyCol: number | null,
  codeCol: number | null = null,
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
      code:
        codeCol === null
          ? null
          : row[codeCol] === null || row[codeCol] === undefined
            ? null
            : String(row[codeCol]).trim() || null,
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

// ---- Costing evidence per identified item ----------------------------------

export interface ValuationRecord {
  bRowNum: number;
  name: string;
  price: number | null;
  qty: number | null;
  code: string | null;
}

export interface Valuation {
  /** Costing records with a usable positive price. */
  count: number;
  /** Records sharing the identity but carrying zero/unreadable prices. */
  zeroCount: number;
  lowest: number | null;
  highest: number | null;
  /** Qty-weighted average when quantities exist, otherwise the simple mean. */
  weightedAvg: number | null;
  records: ValuationRecord[];
  truncated: boolean;
}

export type ValuationFlag =
  | "in-range" // claimed price sits inside [lowest, highest]
  | "above" // claimed above the highest costing price (potential overpayment)
  | "above-allowed" // above the range but within the depreciation allowance (ACV)
  | "below" // claimed below the lowest costing price
  | "unpriced"; // no usable costing price on either side

/**
 * Collect every costing record linked to each identified claim row (the
 * engine's candidate set — nothing is locked, so one item gathers all its
 * costing rows and one costing row may serve several claim rows).
 * Zero/unreadable prices are counted but excluded from the range statistics:
 * a missing price is not evidence of a cheap item.
 */
export function computeValuation(
  results: MatchResult[],
  bQty: Record<RowNum, number | null>,
): Map<number, Valuation> {
  const map = new Map<number, Valuation>();
  for (const r of results) {
    if (r.candidates.length === 0) continue;
    const records: ValuationRecord[] = r.candidates.map((c) => ({
      bRowNum: c.bRowNum,
      name: c.rawName,
      price: c.price,
      qty: bQty[c.bRowNum] ?? null,
      code: c.matchedCode ?? null,
    }));
    const priced = records.filter((x) => x.price !== null && x.price > 0);
    const zeroCount = records.length - priced.length;
    const prices = priced.map((x) => x.price as number);
    const lowest = prices.length ? Math.min(...prices) : null;
    const highest = prices.length ? Math.max(...prices) : null;
    let weightedAvg: number | null = null;
    if (prices.length) {
      const withQty = priced.filter((x) => x.qty !== null && (x.qty as number) > 0);
      if (withQty.length > 0) {
        let sumPQ = 0;
        let sumQ = 0;
        for (const x of withQty) {
          sumPQ += (x.price as number) * (x.qty as number);
          sumQ += x.qty as number;
        }
        weightedAvg = sumQ > 0 ? round2(sumPQ / sumQ) : round2(prices.reduce((a, b) => a + b, 0) / prices.length);
      } else {
        weightedAvg = round2(prices.reduce((a, b) => a + b, 0) / prices.length);
      }
    }
    map.set(r.id, {
      count: priced.length,
      zeroCount,
      lowest,
      highest,
      weightedAvg,
      records,
      truncated: false,
    });
  }
  return map;
}

/**
 * Position of the claimed price relative to the costing evidence. The
 * depreciation allowance (ACV) is a display-layer interpretation: a claim
 * above the costing range by at most depreciationPct% is EXPECTED when the
 * adjuster applied actual-cash-value — it is flagged as "above-allowed"
 * instead of plain "above". Identity statuses are never touched.
 */
export function valuationFlag(
  val: Valuation | undefined,
  aPrice: number | null,
  depreciationPct: number,
): ValuationFlag {
  if (!val || val.count === 0 || aPrice === null) return "unpriced";
  if (aPrice > (val.highest as number)) {
    const overPct = ((aPrice - (val.highest as number)) / aPrice) * 100;
    return depreciationPct > 0 && overPct <= depreciationPct ? "above-allowed" : "above";
  }
  if (aPrice < (val.lowest as number)) return "below";
  return "in-range";
}

/**
 * Overpayment exposure: on rows where the claim sits ABOVE the entire costing
 * range, the amount at stake is (claimed − highest) per unit. Rows flagged
 * above-allowed (depreciation-explained) are excluded.
 */
export function overpaymentExposure(
  results: MatchResult[],
  valuation: Map<number, Valuation>,
  depreciationPct: number,
): { count: number; amount: number } {
  let count = 0;
  let amount = 0;
  for (const r of results) {
    if (valuationFlag(valuation.get(r.id), r.aPrice, depreciationPct) !== "above") continue;
    const val = valuation.get(r.id)!;
    count++;
    amount += r.aPrice! - (val.highest as number);
  }
  return { count, amount: round2(amount) };
}

/** Identity statuses that assert a real pairing (used for B-side coverage). */
export const PAIRING_STATUSES: Status[] = ["CONFIRMED", "STRONG"];

/**
 * B rowNums asserted into the reconciliation: every candidate of a row whose
 * identity is established (Confirmed/Strong, including manual/Jev upgrades).
 * Probable suggestions and conflict rows do not consume costing lines — they
 * are only leads until a human confirms them.
 */
export function claimedBRowNums(results: MatchResult[]): Set<RowNum> {
  const set = new Set<RowNum>();
  for (const r of results) {
    if (!PAIRING_STATUSES.includes(r.status)) continue;
    if (r.chosen) set.add(r.chosen.bRowNum);
    for (const c of r.candidates) set.add(c.bRowNum);
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

/** Costing lines no claim row was matched to — the reverse-coverage view. */
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
