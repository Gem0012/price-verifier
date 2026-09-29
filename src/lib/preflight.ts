import type { ParsedWorkbook } from "./parse.ts";
import type { AnalyzedSheet, CodeStripMode, SheetColumn } from "./types.ts";
import {
  cleanPrice,
  detectCodeStripMode,
  isNonItemDescription,
  normalizeDescription,
  stripCode,
} from "./normalize.ts";

/**
 * Upload-time health check for one analyzed sheet.
 *
 * Runs a single fast pass over the ALREADY-PARSED rows (no re-parsing, no
 * React) so a 20,000-row sheet is analyzed in a few milliseconds. The result
 * feeds the compact health panel on the upload screen, giving the user a
 * chance to fix mapping surprises (blank names, unparseable prices, Excel
 * dates stored as serial numbers, duplicate names) BEFORE running a compare.
 */

export type HealthVerdict = "looks good" | "warnings" | "problems";

/** One sample problem cell: 1-based spreadsheet row number + display text. */
export interface HealthSample {
  rowNum: number;
  raw: string;
}

/** A normalized name seen more than once in the name column. */
export interface DuplicateSample {
  name: string;
  count: number;
  /** Up to 3 of the (1-based) rows where this name appears. */
  rowSamples: number[];
}

export interface PriceHealth {
  /** Rows whose price cell parses to a number via cleanPrice. */
  readableCount: number;
  /** readableCount / rowCount * 100, rounded to 0.1. */
  readablePercent: number;
  /** Non-blank price cells cleanPrice cannot read ("N/A", "TBA", …). */
  unreadableCount: number;
  unreadableSamples: HealthSample[];
  /** Rows (with a name) whose price cell is blank. Informational. */
  missingPriceCount: number;
  zeroPriceCount: number;
  zeroSamples: HealthSample[];
  negativeCount: number;
  negativeSamples: HealthSample[];
  /**
   * Numeric cells that look like Excel date serials (whole numbers in
   * 20000-60000). Only reported when the pattern repeats (>= 3 cells) so a
   * legitimately pricey item does not trip the flag.
   */
  suspiciousDateLikeCount: number;
  dateLikeSamples: HealthSample[];
  /** Prices stored as strings that still parse. Informational only. */
  textPriceCount: number;
  textPriceSamples: HealthSample[];
}

export interface CodePatternHealth {
  /** Mode detectCodeStripMode finds in the name column (what auto mode uses). */
  mode: CodeStripMode;
  /** Short badge label, e.g. "codes: first token" or "full names". */
  label: string;
  /** One "raw -> stripped" example, or null when mode is "none". */
  example: { raw: string; stripped: string } | null;
  /** One-sentence human explanation. */
  note: string;
}

export interface HeaderInfo {
  /** Chosen header row, 1-based for display. */
  headerRow: number;
  nameColLabel: string;
  priceColLabel: string;
}

export interface FileHealth {
  /** Non-blank name cells in the chosen name column (below the header row). */
  rowCount: number;
  /**
   * Rows where the name cell is blank but the row carries other data.
   * `samples` holds up to 5 (rowNum + a snippet of the first non-blank cell).
   */
  blankNameRows: { count: number; samples: HealthSample[] };
  /** Distinct names (normalized) that appear more than once + up to 5 samples. */
  duplicateDescriptions: { count: number; samples: DuplicateSample[] };
  price: PriceHealth;
  codePattern: CodePatternHealth;
  headerInfo: HeaderInfo;
  verdict: HealthVerdict;
  /** One short human summary line shown next to the status dot. */
  summary: string;
  /** "What this means" sentences, shown when warnings exist. */
  hints: string[];
}

/**
 * The upload screen lets the user override the header row and name/price
 * columns; `analysis.mapping` only carries the auto-detected values. Pass the
 * user's actual choices here. All fields are optional — when omitted the
 * values from `analysis` are used.
 */
export interface PreflightOverrides {
  headerRow?: number;
  nameCol?: number;
  priceCol?: number;
}

const MAX_SAMPLES = 5;
const MAX_DUP_ROW_SAMPLES = 3;
const SNIPPET_MAX = 60;
const EXAMPLE_MAX = 48;
const DATE_LIKE_MIN = 20000; // Excel serial for 1954-10-17
const DATE_LIKE_MAX = 60000; // Excel serial for 2064-04-05
const DATE_LIKE_MIN_CELLS = 3;
/** When more than this share of readable prices are date-like, the price
 * column was probably mis-picked (it holds a date column) → "problems". */
const DATE_LIKE_PROBLEM_RATIO = 0.5;
/** Below this % of readable prices the file is flagged as "problems". */
const READABLE_PROBLEM_PCT = 80;

function isBlankCell(v: unknown): boolean {
  return (
    v === null || v === undefined || (typeof v === "string" && v.trim() === "")
  );
}

/** Collapse whitespace for display; numbers/other types via String(). */
function displayRaw(v: unknown): string {
  const s = typeof v === "string" ? v : String(v ?? "");
  return s.replace(/\s+/g, " ").trim();
}

function snippet(v: unknown, max = SNIPPET_MAX): string {
  const s = displayRaw(v);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** 0-based column index -> spreadsheet letters (0="A", 26="AA"). */
function encodeCol(i: number): string {
  let s = "";
  let n = Math.max(i, 0);
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function columnLabel(columns: SheetColumn[], idx: number): string {
  const byPos = columns[idx];
  if (byPos && byPos.index === idx && byPos.label) return byPos.label;
  const found = columns.find((c) => c.index === idx);
  if (found?.label) return found.label;
  return `Column ${encodeCol(idx)}`;
}

function describeCodePattern(mode: CodeStripMode): {
  label: string;
  note: string;
} {
  switch (mode) {
    case "firstToken":
      return {
        label: "codes: first token",
        note: "Item code detected at the start of most names — auto mode strips it before matching.",
      };
    case "lastToken":
      return {
        label: "codes: last token",
        note: "Item code detected at the end of most names — auto mode strips it before matching.",
      };
    default:
      return {
        label: "full names",
        note: "No item-code pattern detected — matching will use full names.",
      };
  }
}

/**
 * Single-pass ASCII fast path for duplicate keys: exactly what
 * normalizeDescription produces for pure-ASCII input (lowercase, every
 * non-[a-z0-9] char becomes a space, trimmed and collapsed). Any non-ASCII
 * char bails out to the real normalizeDescription, where NFKC folding and the
 * smart-quote/dash maps live. This keeps 20k-row sheets far under the
 * 100ms budget without changing duplicate semantics.
 */
function normalizeKey(raw: string): string {
  let out = "";
  let pendingSpace = true; // also suppresses leading/trailing spaces
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code > 127) return normalizeDescription(raw); // rare: full pipeline
    let ch: string;
    if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) {
      ch = raw[i]; // a-z 0-9 kept as-is
    } else if (code >= 65 && code <= 90) {
      ch = String.fromCharCode(code + 32); // A-Z -> a-z
    } else {
      ch = " "; // everything else ASCII -> separator
    }
    if (ch === " ") {
      if (pendingSpace) continue;
      pendingSpace = true;
      out += " ";
    } else {
      pendingSpace = false;
      out += ch;
    }
  }
  return out;
}

export function analyzeFileHealth(
  parsed: ParsedWorkbook,
  analysis: AnalyzedSheet,
  chosen?: PreflightOverrides,
): FileHealth {
  const headerRow = Math.max(chosen?.headerRow ?? analysis.headerRow, 0);
  const nameCol = chosen?.nameCol ?? analysis.mapping.nameCol;
  const priceCol = chosen?.priceCol ?? analysis.mapping.priceCol;

  // The analyzed sheet is always one of parsed.sheets — find it by name so the
  // health check reads the exact rows that were already parsed (no re-parse).
  const sheet =
    parsed.sheets.find((s) => s.name === analysis.name) ??
    parsed.sheets.find((s) => s.name === analysis.mapping.sheetName);
  const rows = sheet?.rows ?? [];

  const headerInfo: HeaderInfo = {
    headerRow: headerRow + 1,
    nameColLabel: columnLabel(analysis.columns, nameCol),
    priceColLabel: columnLabel(analysis.columns, priceCol),
  };

  // ---- single pass over the data rows -------------------------------------
  let rowCount = 0;
  let blankCount = 0;
  const blankSamples: HealthSample[] = [];
  const dupIndex = new Map<
    string,
    { count: number; name: string; rows: number[] }
  >();
  let readableCount = 0;
  let unreadableCount = 0;
  let missingPriceCount = 0;
  let zeroPriceCount = 0;
  let negativeCount = 0;
  let dateLikeCount = 0;
  let textPriceCount = 0;
  const unreadableSamples: HealthSample[] = [];
  const zeroSamples: HealthSample[] = [];
  const negativeSamples: HealthSample[] = [];
  const dateLikeSamples: HealthSample[] = [];
  const textPriceSamples: HealthSample[] = [];
  const names: string[] = []; // fed to detectCodeStripMode after the loop

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const nameVal = row[nameCol];

    if (isBlankCell(nameVal)) {
      // Only interesting when the row carries other data.
      let firstCell: unknown = null;
      for (let c = 0; c < row.length; c++) {
        const v = row[c];
        if (!isBlankCell(v)) {
          firstCell = v;
          break;
        }
      }
      if (firstCell !== null) {
        blankCount++;
        if (blankSamples.length < MAX_SAMPLES) {
          blankSamples.push({ rowNum: r + 1, raw: snippet(firstCell) });
        }
      }
      continue; // the matcher skips these rows entirely
    }

    rowCount++;
    // No per-row whitespace regex here (hot path) — the strict FAST_NAME_KEY
    // rejects anything displayRaw would have had to clean up.
    const rawName =
      typeof nameVal === "string" ? nameVal : String(nameVal ?? "");
    names.push(rawName);

    // Duplicates use the same normalization as the matcher. Footer/total rows
    // are excluded — the matcher drops them, so they are not real ambiguity.
    const cleaned = normalizeKey(rawName);
    if (cleaned && !isNonItemDescription(cleaned)) {
      const entry = dupIndex.get(cleaned);
      if (entry) {
        entry.count++;
        if (entry.rows.length < MAX_DUP_ROW_SAMPLES) entry.rows.push(r + 1);
      } else {
        dupIndex.set(cleaned, { count: 1, name: rawName, rows: [r + 1] });
      }
    }

    const priceVal = row[priceCol];
    if (isBlankCell(priceVal)) {
      missingPriceCount++;
      continue;
    }
    const price = cleanPrice(priceVal);
    if (price === null) {
      unreadableCount++;
      if (unreadableSamples.length < MAX_SAMPLES) {
        unreadableSamples.push({ rowNum: r + 1, raw: snippet(priceVal) });
      }
      continue;
    }
    readableCount++;

    if (price === 0) {
      zeroPriceCount++;
      if (zeroSamples.length < MAX_SAMPLES) {
        zeroSamples.push({ rowNum: r + 1, raw: snippet(priceVal, 20) });
      }
    } else if (price < 0) {
      negativeCount++;
      if (negativeSamples.length < MAX_SAMPLES) {
        negativeSamples.push({ rowNum: r + 1, raw: snippet(priceVal, 20) });
      }
    }

    if (typeof priceVal === "number") {
      // Excel stores dates as whole-day serial numbers; 20000-60000 covers
      // 1954-2064. Flagged only when the pattern repeats (>= 3 cells) so a
      // legitimately pricey item does not trip it.
      if (
        Number.isInteger(priceVal) &&
        priceVal >= DATE_LIKE_MIN &&
        priceVal <= DATE_LIKE_MAX
      ) {
        dateLikeCount++;
        if (dateLikeSamples.length < MAX_SAMPLES) {
          dateLikeSamples.push({ rowNum: r + 1, raw: snippet(priceVal, 20) });
        }
      }
    } else if (typeof priceVal === "string") {
      // Readable but stored as text — informational only.
      textPriceCount++;
      if (textPriceSamples.length < MAX_SAMPLES) {
        textPriceSamples.push({ rowNum: r + 1, raw: snippet(priceVal) });
      }
    }
  }

  // ---- duplicates ----------------------------------------------------------
  const dupSamples: DuplicateSample[] = [];
  let dupCount = 0;
  for (const entry of dupIndex.values()) {
    if (entry.count > 1) {
      dupCount++;
      if (dupSamples.length < MAX_SAMPLES) {
        dupSamples.push({
          name: snippet(entry.name),
          count: entry.count,
          rowSamples: entry.rows,
        });
      }
    }
  }

  // Date-like cells only count when the pattern repeats.
  const suspiciousDateLikeCount =
    dateLikeCount >= DATE_LIKE_MIN_CELLS ? dateLikeCount : 0;
  const dateLikeSamplesOut =
    suspiciousDateLikeCount > 0 ? dateLikeSamples : [];

  const readablePercent = rowCount
    ? Math.round((readableCount / rowCount) * 1000) / 10
    : 0;

  // ---- code pattern --------------------------------------------------------
  const detected = detectCodeStripMode(names);
  const { label: codeLabel, note: codeNote } = describeCodePattern(detected.mode);
  let example: { raw: string; stripped: string } | null = null;
  if (detected.mode !== "none") {
    for (const n of names) {
      if (!n || !/\s/.test(n)) continue; // stripCode needs 2+ tokens
      const trimmed = n.trim();
      const stripped = stripCode(n, detected);
      if (stripped && stripped !== trimmed) {
        example = {
          raw: snippet(trimmed, EXAMPLE_MAX),
          stripped: snippet(stripped, EXAMPLE_MAX),
        };
        break;
      }
    }
  }

  // ---- verdict -------------------------------------------------------------
  const warningCategories = [
    blankCount > 0,
    dupCount > 0,
    unreadableCount > 0,
    suspiciousDateLikeCount > 0,
    zeroPriceCount > 0,
    negativeCount > 0,
  ].filter(Boolean).length;

  let verdict: HealthVerdict = "looks good";
  let summary: string;
  if (rowCount === 0) {
    verdict = "problems";
    summary = `No data rows found below row ${headerInfo.headerRow} — check the header row and name column.`;
  } else if (readablePercent < READABLE_PROBLEM_PCT) {
    verdict = "problems";
    summary = `Only ${readablePercent}% of prices are readable — check the price column ("${headerInfo.priceColLabel}").`;
  } else if (
    suspiciousDateLikeCount > 0 &&
    readableCount > 0 &&
    suspiciousDateLikeCount / readableCount > DATE_LIKE_PROBLEM_RATIO
  ) {
    // A column that is mostly date serials was almost certainly mis-picked as
    // the price column — dates parse as numbers, so readable% alone hides it.
    verdict = "problems";
    summary = `Most prices look like Excel date serials (e.g. ${dateLikeSamples[0]?.raw ?? "45123"}) — check the price column dropdown.`;
  } else if (warningCategories > 0) {
    verdict = "warnings";
    summary = `${rowCount.toLocaleString()} rows · ${readablePercent}% prices readable · ${warningCategories} ${warningCategories === 1 ? "issue" : "issues"} to review`;
  } else {
    summary = `${rowCount.toLocaleString()} rows · ${readablePercent}% prices readable · no issues detected`;
  }

  // "What this means" hints — shown when warnings exist.
  const hints: string[] = [];
  if (blankCount > 0) hints.push("Blank-name rows are skipped by the matcher.");
  if (unreadableCount > 0)
    hints.push(
      "Unreadable prices can't be compared — those rows will need review.",
    );
  if (suspiciousDateLikeCount > 0)
    hints.push("These may be Excel dates — check the price column dropdown.");
  if (dupCount > 0)
    hints.push(
      "Duplicate names make 1:1 matching ambiguous (MULTIPLE matches).",
    );
  if (zeroPriceCount > 0)
    hints.push("Zero prices are compared as 0 and may flag false mismatches.");
  if (negativeCount > 0)
    hints.push(
      "Negative prices may be credits or sign errors — double-check them.",
    );

  return {
    rowCount,
    blankNameRows: { count: blankCount, samples: blankSamples },
    duplicateDescriptions: { count: dupCount, samples: dupSamples },
    price: {
      readableCount,
      readablePercent,
      unreadableCount,
      unreadableSamples,
      missingPriceCount,
      zeroPriceCount,
      zeroSamples,
      negativeCount,
      negativeSamples,
      suspiciousDateLikeCount,
      dateLikeSamples: dateLikeSamplesOut,
      textPriceCount,
      textPriceSamples,
    },
    codePattern: { mode: detected.mode, label: codeLabel, example, note: codeNote },
    headerInfo,
    verdict,
    summary,
    hints,
  };
}
