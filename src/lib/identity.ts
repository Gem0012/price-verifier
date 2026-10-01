import { normalizeDescription } from "./normalize.ts";

// ---- Identity extraction (three-layer model, layer 1: identification) -------
// A description is parsed into STRUCTURED identity attributes instead of being
// fuzzy-matched as one blob:
//   codes  — part/model numbers ("A-1022", "KBJ-1202", "23390-0L070"), the
//            strongest identity signal in auto-parts data
//   dims   — dimension tuples ("27x40x6") that distinguish sizes of a family
//   words  — the remaining content words (family, type, brand, qualifiers)
// Original descriptions are never modified — this produces working keys only.

/**
 * Normalize a part/model code: uppercase, strip separators. "A-1022" and
 * "A1022" collapse to A1022. Returns null when the value cannot be a code
 * (no digit, too short, or absurdly long).
 */
export function normalizePartCode(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length < 4 || s.length > 24) return null;
  if (!/\d/.test(s)) return null;
  return s;
}

/** Reject date-shaped digit groups ("2024", "05", "2024") from code patterns. */
function looksDateSegment(seg: string): boolean {
  return /^(19|20)\d{2}$/.test(seg);
}

/**
 * Pack/quantity words that sit right before a number — "per box 100 pcs" must
 * NOT yield the phantom code BOX100. Packaging facts are not part numbers.
 */
const PACK_WORDS = new Set([
  "BOX", "BOXES", "CARTON", "CARTONS", "CTN", "PACK", "PACKS", "PKG",
  "PKGS", "PIECE", "PIECES", "PCS", "PC", "SHEET", "SHEETS", "ROLL",
  "ROLLS", "BAG", "BAGS", "SACK", "SACKS", "SET", "SETS", "PAIR", "PAIRS",
  "DOZEN", "DZ", "KG", "KILO", "GRAM", "GRAMS", "LTR", "LITER", "LITRE",
  "LENGTH", "WIDTH", "SIZE", "QTY", "QUANTITY", "PER", "GROSS", "NET",
  "WEIGHT", "WT", "CAP", "PCS.", "PC.",
]);

/**
 * Part/model codes embedded in a RAW description. Runs on the original text
 * (before punctuation stripping) because separators are what make a code
 * recognizable. Letter+digit codes need ≥3 digits so sizes like "M8" and "5L"
 * never qualify; Toyota-style prefixes (5–6 digits) and digit-digit codes
 * ("208-54109") are recognized while calendar dates and pack sizes are rejected.
 */
export function extractCodesFromText(raw: string): string[] {
  const out = new Set<string>();
  const text = String(raw ?? "").toUpperCase();
  const add = (raw2: string): void => {
    const c = normalizePartCode(raw2);
    if (c) out.add(c);
  };

  // Toyota/Nissan style: 23390-0L070, 90915-YZZD1 (5–6 digit prefix).
  for (const m of text.matchAll(/\b(\d{5,6}-[A-Z0-9]{2,10})\b/g)) add(m[1]);

  // Letter-prefixed: A-1022, KBJ-1202, PRD-26051 (optionally space-separated).
  // The date guard is skipped for explicit alpha prefixes — "KBJ-1912" is a
  // part number whose tail happens to look like a year.
  for (const m of text.matchAll(/\b([A-Z]{1,4})[-\s](\d{3,6}[A-Z0-9]*)\b/g)) {
    if (/^[A-Z]/.test(m[1]) || !looksDateSegment(m[2])) add(`${m[1]}-${m[2]}`);
  }

  // Joined letter+digit: A1022, KBJ1202 (≥3 digits so "M8"/"5L" stay out).
  for (const m of text.matchAll(/\b([A-Z]{1,5}\d{3,}[A-Z0-9]*)\b/g)) add(m[1]);

  // Digit-digit: 208-54109 — two segments, no year-shaped segment, tail ≥3.
  for (const m of text.matchAll(/\b(\d{2,6})-(\d{3,6})\b/g)) {
    if (!looksDateSegment(m[1]) && !looksDateSegment(m[2])) add(`${m[1]}-${m[2]}`);
  }

  // Drop phantom codes produced by pack phrases ("per box 100 pcs" → BOX100).
  for (const c of [...out]) {
    const prefix = c.match(/^[A-Z]+/)?.[0];
    if (prefix && PACK_WORDS.has(prefix)) out.delete(c);
  }
  return [...out];
}

/**
 * Dimension tuples: "27x40x6", "27 × 40 × 6", "27-40-6" → "27x40x6".
 * Hyphen-separated numbers qualify only when every segment is ≤3 digits
 * (part numbers and dates are longer). Order is preserved — ID×W×T matters.
 */
export function extractDimensions(raw: string): string[] {
  const text = String(raw ?? "").toUpperCase();
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(\d{1,3}(?:\s*[X×✕]\s*\d{1,3}){1,3})\b/g)) {
    out.add(m[1].replace(/\s+/g, "").toLowerCase());
  }
  // Only try hyphen dims on text AFTER code-shaped tokens are removed, so
  // "23390-0L070" or "208-54109" are never read as dimensions.
  const stripped = text
    .replace(/\b\d{5}-[A-Z0-9]{2,10}\b/g, " ")
    .replace(/\b[A-Z]{1,4}[-\s]\d{3,6}[A-Z0-9]*\b/g, " ")
    .replace(/\b[A-Z]{1,5}\d{3,}[A-Z0-9]*\b/g, " ")
    .replace(/\b\d{2,6}-\d{3,6}\b/g, " ");
  for (const m of stripped.matchAll(/\b(\d{1,3}(?:-\d{1,3}){1,3})\b/g)) {
    if (m[1].split("-").every((p) => Number(p) > 0)) {
      out.add(m[1].replace(/-/g, "x").toLowerCase());
    }
  }
  return [...out];
}

export interface Identity {
  codes: string[];
  dims: string[];
  /** Content words left after codes/dims/stopwords are removed. */
  words: string[];
}

const STOPWORDS = new Set([
  "for", "with", "and", "or", "of", "the", "per", "no", "nr", "size", "type",
  "new", "set", "sets", "pair", "pcs", "pc", "piece", "pieces", "box", "pack",
  "genuine", "oem", "aftermarket", "replacement", "part", "parts", "number",
]);

/** Code/dim tokens that must not re-enter the word list. */
function stripAttributeTokens(words: string[], id: { codes: string[]; dims: string[] }): string[] {
  const attrTokens = new Set<string>();
  for (const code of id.codes) {
    // Both the joined form ("a1022") and the split form ("a", "1022").
    attrTokens.add(code.toLowerCase());
    const split = code.toLowerCase().match(/^[a-z]+|\d+[a-z0-9]*/g) ?? [];
    for (const t of split) attrTokens.add(t);
  }
  for (const dim of id.dims) {
    for (const t of dim.split("x")) attrTokens.add(t);
  }
  return words.filter((w) => !attrTokens.has(w));
}

/**
 * Full identity parse of one description. `partNo` is the optional structured
 * code column value — it wins over text extraction when present.
 */
export function extractIdentity(raw: unknown, partNo?: unknown): Identity {
  const rawStr = String(raw ?? "");
  const codes = new Set<string>();
  const fromCol = normalizePartCode(partNo);
  if (fromCol) codes.add(fromCol);
  for (const c of extractCodesFromText(rawStr)) codes.add(c);
  const dims = extractDimensions(rawStr);
  const cleaned = normalizeDescription(rawStr);
  const words = stripAttributeTokens(
    cleaned.split(" ").filter((t) => t && !STOPWORDS.has(t) && !/^\d+(x\d+)+$/.test(t)),
    { codes: [...codes], dims },
  );
  return { codes: [...codes], dims, words };
}

/** Jaccard overlap of two word lists — 1 = identical vocabulary, 0 = disjoint. */
export function wordOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 1; // nothing to conflict over
  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const w of setA) if (setB.has(w)) shared++;
  return shared / (setA.size + setB.size - shared);
}

/** True when two dimension tuples disagree (both present, different values). */
export function dimsConflict(a: string[], b: string[]): boolean {
  return a.length > 0 && b.length > 0 && !a.every((d) => b.includes(d));
}
