import * as XLSX from "xlsx";
import type { AnalyzedSheet, SheetColumn } from "./types.ts";
import { cleanPrice } from "./normalize.ts";

export interface RawSheetData {
  name: string;
  /** rows[i] is spreadsheet row i+1; includes the header row */
  rows: unknown[][];
}

export interface ParsedWorkbook {
  fileName: string;
  sheets: RawSheetData[];
}

export async function readWorkbook(file: File): Promise<ParsedWorkbook> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheets = wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    }),
  }));
  return { fileName: file.name, sheets };
}

const NAME_KEYWORDS =
  /(descript|item|product|particular|goods|material|article|spec|name|descripcion|nombre|nama|uraian|deskripsi|artikel)/i;
const PRICE_KEYWORDS =
  /(price|amount|cost|rate|value|selling|net|gross|unit\s*cost|unit\s*price|harga|precio|importe|presyo|halaga|preco|preis|prix)/i;
// Columns with these labels hold dates, never prices — penalized when picking
// the price column so an Excel date/serial column is not mistaken for amounts.
const DATE_LABEL =
  /(date|tanggal|fecha|datum|effectivity|as\s*of)/i;

// Part/model/SKU code columns: "Part No.", "Product / Inventory Code", "Code",
// "SKU", "Model No." — a separate identity signal fed to the matching engine.
const CODE_LABEL =
  /(part\s*(no|num|number)|model\s*(no|num|number|code)|product[^\n]{0,20}code|inventory\s*code|item\s*code|stock\s*(no|code)|sku|^code\b|kode|codigo)/i;

/** Lowercase + strip diacritics so "Descripción", "PREÇO", "Nama" match keywords. */
function foldLabel(s: string): string {
  return s
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Whole-value numeric shape: optional currency prefix/symbols/parens around a
// number. Unlike cleanPrice (which salvages digits from anywhere), this will
// not call "ITM-00001 Steel Nail 2 inch" a number just because it contains one.
const NUMERIC_SHAPE =
  /^[(-]*\s*[₱$€£¥]?\s*(?:p|php|ps|usd|eur|gbp|aud|cad|sgd|myr|rm|idr|inr|jpy|cny|rmb|thb|vnd|krw|hkd|twd|zar|ngn|kes|aed|sar|qar|kwd|bhd|omr|jod|ils|try|brl|mxn|ars|clp|cop|lak|khr|mmk|bnd)?\s*[-+]?\d[\d.,\s]*\)?$/i;

export function looksNumeric(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v !== "string") return false;
  const s = v.replace(/\u00A0/g, " ").trim();
  return s !== "" && /\d/.test(s) && NUMERIC_SHAPE.test(s);
}

function isBlankRow(row: unknown[] | null | undefined): boolean {
  return (
    !row || row.every((c) => c === null || c === undefined || String(c).trim() === "")
  );
}

export function detectHeaderRow(rows: unknown[][]): number {
  let bestIdx = 0;
  let bestScore = -Infinity;
  // Wider window: real sheets often carry a title block + blank rows above the
  // header. Scoring is comparative, and header rows outscore data rows because
  // of keyword bonuses and the numeric penalty on data cells.
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i++) {
    const row = rows[i];
    if (isBlankRow(row)) continue;
    const cells = row.filter(
      (c) => c !== null && c !== undefined && String(c).trim() !== "",
    );
    if (cells.length < 2) continue;
    let score = 0;
    let numeric = 0;
    for (const c of cells) {
      const s = String(c).trim();
      if (cleanPrice(s) !== null && /^[0-9(£$€¥₱\s.,-]+$/.test(s)) numeric++;
      if (typeof c === "string") {
        score += 1;
        const folded = foldLabel(s);
        if (NAME_KEYWORDS.test(folded) || PRICE_KEYWORDS.test(folded)) score += 3;
      }
    }
    score -= numeric * 2;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function pickNameCol(columns: SheetColumn[]): number {
  let best = -1;
  let bestScore = -Infinity;
  for (const c of columns) {
    if (c.stringRatio < 0.4) continue;
    let score = c.stringRatio * 3;
    if (NAME_KEYWORDS.test(foldLabel(c.label))) score += 5;
    const avgLen =
      c.samples.reduce((m, s) => m + s.length, 0) / Math.max(c.samples.length, 1);
    score += Math.min(avgLen, 40) / 20;
    if (score > bestScore) {
      bestScore = score;
      best = c.index;
    }
  }
  if (best >= 0) return best;
  // fallback: column with the highest string ratio
  let maxRatio = -1;
  for (const c of columns) {
    if (c.stringRatio > maxRatio) {
      maxRatio = c.stringRatio;
      best = c.index;
    }
  }
  return Math.max(best, 0);
}

function pickPriceCol(columns: SheetColumn[], exclude: number, exclude2: number): number {
  let best = -1;
  let bestScore = -Infinity;
  for (const c of columns) {
    if (c.index === exclude || c.index === exclude2) continue;
    if (c.numericRatio < 0.3) continue;
    let score = c.numericRatio * 3;
    const folded = foldLabel(c.label);
    if (PRICE_KEYWORDS.test(folded)) score += 5;
    // A date/serial column ("Date Encoded", 45000-style serials) is full of
    // plausible-looking numbers — keep it away from the price column.
    if (DATE_LABEL.test(folded)) score -= 6;
    if (score > bestScore) {
      bestScore = score;
      best = c.index;
    }
  }
  if (best >= 0) return best;
  // fallback: any numeric-ish column other than the name/code columns,
  // preferring ones that do not look like dates
  for (const c of columns) {
    if (
      c.index !== exclude &&
      c.index !== exclude2 &&
      c.numericRatio > 0 &&
      !DATE_LABEL.test(foldLabel(c.label))
    )
      return c.index;
  }
  for (const c of columns) {
    if (c.index !== exclude && c.index !== exclude2 && c.numericRatio > 0) return c.index;
  }
  return columns.length > 1 ? 1 : 0;
}

/**
 * Pick the part/model/SKU code column: a code-labeled column that is not the
 * name or price column and actually carries data. Blank or zero-filled code
 * columns still qualify (the engine ignores unreadable values) — the real
 * Ending Inventory pattern is a blank code column with codes embedded in the
 * descriptions instead.
 */
function pickCodeCol(columns: SheetColumn[], nameCol: number, priceCol: number): number | null {
  let best = -1;
  let bestScore = -Infinity;
  for (const c of columns) {
    if (c.index === nameCol || c.index === priceCol) continue;
    if (!(c.stringRatio > 0 || c.numericRatio > 0)) continue;
    const folded = foldLabel(c.label);
    if (!CODE_LABEL.test(folded)) continue;
    let score = Math.max(c.stringRatio, c.numericRatio) * 2;
    if (/^code$|part\s*(no|num|number)|sku/.test(folded)) score += 3;
    if (score > bestScore) {
      bestScore = score;
      best = c.index;
    }
  }
  return best >= 0 ? best : null;
}

export function analyzeSheet(
  sheet: RawSheetData,
  headerRowOverride?: number,
): AnalyzedSheet {
  const rows = sheet.rows;
  const headerRow = headerRowOverride ?? detectHeaderRow(rows);
  const width = rows.reduce((m, r) => Math.max(m, r?.length ?? 0), 0);
  const headerCells = rows[headerRow] ?? [];

  const columns: SheetColumn[] = [];
  const scanLimit = Math.min(rows.length, headerRow + 301);
  for (let i = 0; i < width; i++) {
    const headerVal = headerCells[i];
    const label =
      headerVal !== null && headerVal !== undefined && String(headerVal).trim() !== ""
        ? String(headerVal).trim()
        : `Column ${XLSX.utils.encode_col(i)}`;
    const samples: string[] = [];
    let stringCount = 0;
    let numericCount = 0;
    let filled = 0;
    for (let r = headerRow + 1; r < scanLimit; r++) {
      const v = rows[r]?.[i];
      if (v === null || v === undefined || String(v).trim() === "") continue;
      filled++;
      if (looksNumeric(v)) numericCount++;
      else stringCount++;
      if (samples.length < 3) samples.push(String(v).trim());
    }
    columns.push({
      index: i,
      label,
      samples,
      stringRatio: filled ? stringCount / filled : 0,
      numericRatio: filled ? numericCount / filled : 0,
    });
  }

  const nameCol = pickNameCol(columns);
  const codeCol = pickCodeCol(columns, nameCol, -1);
  const priceCol = pickPriceCol(columns, nameCol, codeCol ?? -1);
  // A strong code label ("Part No.") may have grabbed the price column's
  // runner-up slot; re-run code picking once the price column is final.
  const codeColFinal =
    codeCol !== null && codeCol !== priceCol ? codeCol : pickCodeCol(columns, nameCol, priceCol);

  let dataRowCount = 0;
  for (let r = headerRow + 1; r < rows.length; r++) {
    const v = rows[r]?.[nameCol];
    if (v !== null && v !== undefined && String(v).trim() !== "") dataRowCount++;
  }

  return {
    name: sheet.name,
    headerRow,
    columns,
    mapping: { sheetName: sheet.name, headerRow, nameCol, priceCol, codeCol: codeColFinal },
    dataRowCount,
    previewRows: rows.slice(headerRow + 1, headerRow + 9),
  };
}
