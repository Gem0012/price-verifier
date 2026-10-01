import type { CodeStripConfig } from "./types.ts";

/**
 * Domain abbreviation standardization — auto-parts shorthand written many ways
 * collapses to one canonical token, so "FRT", "FR" and "Front" all compare
 * equal. Distinctions that carry meaning (left vs right) map to DIFFERENT
 * canonical words; nothing is merged away.
 */
const ABBREV_TOKENS: Record<string, string> = {
  frt: "front",
  fr: "front",
  rr: "rear",
  assy: "assembly",
  lh: "left",
  lhs: "left",
  rh: "right",
  rhs: "right",
};

function applyAbbreviations(s: string): string {
  // "hi lux" → "hilux" (two tokens, one model name) before token mapping.
  s = s.replace(/\bhi lux\b/g, "hilux").replace(/\bhilux\b/g, "hilux");
  return s
    .split(" ")
    .map((t) => {
      if (t === "hi") return "hilux";
      return ABBREV_TOKENS[t] ?? t;
    })
    .join(" ");
}

/**
 * Join dimension/size runs into one token: "27 x 40 x 6", "27-40-6" and
 * "27x40x6" all become "27x40x6", and "M8 X 40" becomes "m8x40" — so seal and
 * bolt sizes compare equal regardless of how the separator was typed.
 */
function joinDimensionRuns(s: string): string {
  s = s.replace(
    /(\d+)\s*x\s*(\d+)(?:\s*x\s*(\d+))?(?:\s*x\s*(\d+))?/g,
    (_m, a, b, c, d) => [a, b, c, d].filter(Boolean).join("x"),
  );
  // Hyphen-origin dims arrive as three spaced numbers after punctuation strip.
  return s.replace(/\b(\d{1,3}) (\d{1,3}) (\d{1,3})\b/g, "$1x$2x$3");
}

/**
 * Normalize a description for matching: Unicode-compatible (full-width digits
 * and letters become ASCII), lowercase, trim, collapse spaces, strip
 * punctuation/symbols (kept as spaces so words stay separated), join dimension
 * runs, and standardize domain abbreviations (FRT→front, ASSY→assembly, LH→left…).
 */
export function normalizeDescription(value: unknown): string {
  if (value === null || value === undefined) return "";
  return applyAbbreviations(
    joinDimensionRuns(
      String(value)
        .normalize("NFKC")
        .replace(/[\u2019\u2018]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u00D7\u2715]/g, "x")
        .replace(/[\u2013\u2014]/g, "-")
        .replace(/\u00A0/g, " ")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " "),
    ),
  );
}

/**
 * Coerce messy price values ("₱1,250.00", "PHP 1250", "(500)", 1250, "1.250,50")
 * into a number. Returns null when no number can be recovered.
 *
 * Deliberately REJECTS date-shaped and fraction-shaped text ("2024-05-12",
 * "12/05/2024", "12.05.2024", "5 1/2") — salvaging their digits would turn a
 * date in the price column into a huge meaningless number and a false MISMATCH.
 */
export function cleanPrice(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return null;

  let s = String(value).replace(/\u00A0/g, " ").trim();
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }

  // Date/fraction guards run on the readable text, before symbols are dropped.
  if (/\d\s*\/\s*\d/.test(s)) return null; // "12/05/2024", "5 1/2"
  if ((s.match(/-/g) ?? []).length >= 2) return null; // "2024-05-12"
  if (/\d{1,2}\.\d{1,2}\.\d{2,4}/.test(s)) return null; // "12.05.2024"

  // Keep only digits and separator characters, drop currency codes/symbols/spaces.
  s = s.replace(/[^0-9.,\-]/g, "");

  if (/-$/.test(s)) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (/^-/.test(s)) {
    negative = true;
    s = s.slice(1);
  }

  if (s.includes(",") && s.includes(".")) {
    // The rightmost separator is the decimal one.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(/,/g, ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    const parts = s.split(",");
    const last = parts[parts.length - 1];
    // "1,25" style decimal comma vs "1,250" / "1,234,567" thousands grouping.
    if (parts.length === 2 && last.length !== 3) {
      s = s.replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(".")) {
    const parts = s.split(".");
    if (parts.length > 2) {
      // "1.250.500" — repeated dots are thousands grouping (IDR/EU style),
      // unless the shape is a dot-separated date like "12.05.2024".
      const isDotDate =
        parts.length === 3 &&
        parts[0].length <= 2 &&
        parts[1].length <= 2 &&
        (parts[2].length === 4 || parts[2].length <= 2);
      if (!isDotDate) s = s.replace(/\./g, "");
    }
  }

  if (!s || !/\d/.test(s)) return null;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Precompute the char-bigram set of a normalized description (spaces ignored),
 * so a string compared against many candidates builds its grams only once.
 */
export function bigrams(s: string): Set<string> {
  const sa = s.replace(/ /g, "");
  const grams = new Set<string>();
  for (let i = 0; i < sa.length - 1; i++) grams.add(sa.slice(i, i + 2));
  return grams;
}

/**
 * Dice similarity with a precomputed bigram set for the LEFT side. Produces
 * exactly the same value as similarity(a, b) — the engine uses this to avoid
 * rebuilding A's gram set for every candidate.
 */
export function similarityWithGrams(
  a: string,
  aGrams: Set<string>,
  b: string,
): number {
  const sa = a.replace(/ /g, "");
  const sb = b.replace(/ /g, "");
  if (!sa || !sb) return 0;
  if (sa === sb) return 100;
  if (sa.length < 2 || sb.length < 2) return 0;

  let shared = 0;
  for (let i = 0; i < sb.length - 1; i++) {
    if (aGrams.has(sb.slice(i, i + 2))) shared++;
  }
  const d = (2 * shared) / (sa.length - 1 + sb.length - 1);
  return Math.max(0, Math.round(d * 100) - numericSiblingPenalty(a, b));
}

/**
 * Penalty for "family alike" siblings — descriptions that differ ONLY in
 * numeric tokens (motor parts live here: "bearing 6202 zz" vs "bearing 6203
 * zz" are ~93% alike in character terms but are different parts with
 * different prices). Char-bigram Dice barely notices a changed digit, so
 * every token-level difference that is purely numeric subtracts a fixed
 * penalty, pushing such siblings out of the auto-accept band into review.
 * Any differing WORD token means a genuine rewording — no penalty.
 */
export function numericSiblingPenaltyTokens(
  aCounts: Map<string, number>,
  bCounts: Map<string, number>,
): number {
  let diff = 0;
  let wordDiff = false;
  const countSide = (from: Map<string, number>, to: Map<string, number>) => {
    for (const [t, c] of from) {
      const other = to.get(t) ?? 0;
      if (c > other) {
        diff += c - other;
        if (!/\d/.test(t)) wordDiff = true;
      }
    }
  };
  countSide(aCounts, bCounts);
  countSide(bCounts, aCounts);
  if (diff === 0 || wordDiff) return 0;
  return Math.min(45, 22 * diff);
}

/** Token multiset of a normalized description. */
export function tokenCounts(s: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of s.split(" ")) {
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}

/** Convenience wrapper over numericSiblingPenaltyTokens for two strings. */
export function numericSiblingPenalty(a: string, b: string): number {
  return numericSiblingPenaltyTokens(tokenCounts(a), tokenCounts(b));
}

// ---- numeric-gram fast path (identical values, zero per-call allocation) ---
// Normalized descriptions contain only [a-z0-9 ], so a char-bigram can be
// packed into a single number; Set<number>/number[] membership is much faster
// than string slicing + hashing. The engine uses these helpers.

/** Position-ordered numeric char-bigrams of the space-stripped string. */
export function numericGrams(s: string): { stripped: string; grams: number[] } {
  const sa = s.replace(/ /g, "");
  const grams: number[] = [];
  for (let i = 0; i < sa.length - 1; i++) {
    grams.push((sa.charCodeAt(i) << 16) | sa.charCodeAt(i + 1));
  }
  return { stripped: sa, grams };
}

/** Deduplicated numeric gram set of the space-stripped string. */
export function numericGramSet(s: string): Set<number> {
  const sa = s.replace(/ /g, "");
  const grams = new Set<number>();
  for (let i = 0; i < sa.length - 1; i++) {
    grams.add((sa.charCodeAt(i) << 16) | sa.charCodeAt(i + 1));
  }
  return grams;
}

/**
 * Dice similarity over precomputed numeric grams — the raw char-bigram value
 * WITHOUT the numeric-sibling penalty. The engine adds numericSiblingPenalty
 * on top of this (see matching.ts); similarity() below shows the canonical
 * composition.
 */
export function similarityGramNumbers(
  aStripped: string,
  aGramSet: Set<number>,
  b: { stripped: string; grams: number[] },
): number {
  if (!aStripped || !b.stripped) return 0;
  if (aStripped === b.stripped) return 100;
  if (aStripped.length < 2 || b.stripped.length < 2) return 0;

  let shared = 0;
  const bg = b.grams;
  for (let i = 0; i < bg.length; i++) {
    if (aGramSet.has(bg[i])) shared++;
  }
  const d = (2 * shared) / (aStripped.length - 1 + b.stripped.length - 1);
  return Math.round(d * 100);
}

/**
 * Similarity (0-100) between two normalized descriptions.
 * Char-bigram Dice coefficient over the space-stripped strings: this makes
 * "hex bolt m8 x 40" and "hex bolt m8x40" identical while still ranking
 * reworded descriptions meaningfully. On top of the Dice value, purely
 * numeric token differences ("6202" vs "6203") subtract a sibling penalty —
 * see numericSiblingPenalty.
 */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  return similarityWithGrams(a, bigrams(a), b);
}

/** A plausible item-code token: letters/digits (optionally - or / separated), must contain a digit. */
const CODE_TOKEN = /^(?=.*\d)[a-z0-9]+(?:[-/][a-z0-9]+)*$/i;

/** Dimension runs ("27x40x6", "8x40") are sizes, never item codes. */
function isDimToken(token: string): boolean {
  return /^\d+(?:x\d+)+$/.test(token);
}

function looksLikeCodeFirst(token: string): boolean {
  return !isDimToken(token) && CODE_TOKEN.test(token);
}

/** Last-token codes must contain a letter or be long (so sizes like "40" are not stripped). */
function looksLikeCodeLast(token: string): boolean {
  return !isDimToken(token) && CODE_TOKEN.test(token) && (/[a-z]/i.test(token) || token.length >= 5);
}

/** Drop enclosing brackets so "(ITM-0001)" is recognized as a code token. */
function unwrapToken(token: string): string {
  return token.replace(/^[([{]+|[)\]}]+$/g, "");
}

/** Remove the item code from a File A name according to the configured mode. */
export function stripCode(name: string, cfg: CodeStripConfig): string {
  const n = name.trim();
  if (!n) return "";
  const tokens = n.split(/\s+/);
  if (tokens.length < 2) return n;
  switch (cfg.mode) {
    case "none":
      return n;
    case "firstToken":
      return tokens.slice(1).join(" ") || n;
    case "lastToken":
      return tokens.slice(0, -1).join(" ") || n;
    case "regex":
      try {
        const stripped = n
          .replace(new RegExp(cfg.regex ?? ""), " ")
          .replace(/\s+/g, " ")
          .trim();
        return stripped || n;
      } catch {
        return n;
      }
    default: {
      if (looksLikeCodeFirst(unwrapToken(tokens[0]))) return tokens.slice(1).join(" ");
      if (looksLikeCodeLast(unwrapToken(tokens[tokens.length - 1])))
        return tokens.slice(0, -1).join(" ");
      return n;
    }
  }
}

/**
 * Inspect File A names and decide how the embedded item code should be stripped.
 * A position counts as a code slot when most names carry a code-like token there
 * AND the tokens are varied (codes are high-cardinality; sizes like "2in" repeat).
 */
export function detectCodeStripMode(names: string[]): CodeStripConfig {
  let total = 0;
  let firstCodeLike = 0;
  let lastCodeLike = 0;
  const firstTokens = new Set<string>();
  const lastTokens = new Set<string>();
  for (const raw of names) {
    const tokens = String(raw ?? "").trim().split(/\s+/);
    if (tokens.length < 2) continue;
    total++;
    const first = unwrapToken(tokens[0]);
    const last = unwrapToken(tokens[tokens.length - 1]);
    if (looksLikeCodeFirst(first)) {
      firstCodeLike++;
      firstTokens.add(first.toLowerCase());
    }
    if (looksLikeCodeLast(last)) {
      lastCodeLike++;
      lastTokens.add(last.toLowerCase());
    }
  }
  if (total === 0) return { mode: "none" };

  const firstScore =
    firstCodeLike / total >= 0.6 && firstTokens.size / Math.max(firstCodeLike, 1) >= 0.4
      ? firstCodeLike / total
      : 0;
  const lastScore =
    lastCodeLike / total >= 0.6 && lastTokens.size / Math.max(lastCodeLike, 1) >= 0.4
      ? lastCodeLike / total
      : 0;

  if (firstScore > 0 && firstScore >= lastScore) return { mode: "firstToken" };
  if (lastScore > 0) return { mode: "lastToken" };
  return { mode: "none" };
}

/**
 * Leading tokens that are units/sizes — never codes — so "no 10 wood screw",
 * "2 inch ball valve" or "m8 hex bolt" are not mistreated as coded rows.
 */
const LEADING_UNIT_WORDS = new Set([
  "no", "nr", "size", "mm", "cm", "m", "in", "inch", "kg", "g", "ml", "l",
  "pcs", "pc", "pair", "pr", "set", "ft", "feet", "ea", "roll", "box",
]);

/** Label words that may prefix a pasted description ("vendor: nail 2 inch"). */
const LEADING_LABEL_WORDS = new Set([
  "vendor", "supplier", "sku", "brand", "mfr", "manufacturer", "item",
  "code", "ref", "reference", "stock", "model", "art",
]);

/**
 * A leading code fragment: starts with a letter, contains a digit and at least
 * two letters overall ("itm00001", "ab1001", "vnd77"). Metric sizes like
 * "m8x40" (single letter) and pure numbers never qualify.
 */
const CODELIKE_LEADING = /^(?=[a-z0-9]*[a-z]{2})[a-z][a-z0-9]*\d[a-z0-9]*$/;

/**
 * File B descriptions sometimes start with a stray copy of the item code or a
 * vendor/SKU prefix that File A names never carry ("ITM-0009 Safety Glove
 * Leather", "SKU-123 heavy duty gloves", "VENDOR: nail 2 inch"). Return the
 * description with that leading prefix removed, or null when there is none.
 * Sizes ("2 inch", "no 10", "m8", "m8x40") are never treated as codes.
 */
export function stripLeadingCode(cleaned: string): string | null {
  const tokens = cleaned.split(" ").filter(Boolean);
  if (tokens.length < 2) return null;
  const t0 = tokens[0];
  if (LEADING_UNIT_WORDS.has(t0)) return null;
  if (tokens.length >= 3 && !/\d/.test(t0)) {
    // Split code ("itm 00001", "ab 1001"): the digit arrives with token 2.
    const joined = t0 + tokens[1];
    if (joined.length >= 4 && CODELIKE_LEADING.test(joined)) {
      return tokens.slice(2).join(" ") || null;
    }
  }
  if (t0.length >= 4 && CODELIKE_LEADING.test(t0)) {
    return tokens.slice(1).join(" ") || null;
  }
  if (LEADING_LABEL_WORDS.has(t0)) {
    return tokens.slice(1).join(" ") || null;
  }
  return null;
}

/** Exact normalized descriptions that are report footers, not items. */
const NON_ITEM_EXACT = new Set([
  "total", "subtotal", "sub total", "grand total", "grandtotal",
  "total amount", "amount", "amount due", "amount payable",
  "balance", "balance due", "continuation", "continued",
  "nothing follows", "end of report", "end of list", "end of file",
]);

/**
 * True for rows that are report furniture rather than items: total/footer
 * lines ("TOTAL", "GRAND TOTAL 50,000.00"), page markers, and cells holding
 * only digits/symbols. Real descriptions that merely START with such a word
 * ("total length 5m") are not flagged.
 */
export function isNonItemDescription(cleaned: string): boolean {
  const c = cleaned.trim();
  if (!c) return true;
  if (NON_ITEM_EXACT.has(c)) return true;
  if (!/[a-z]/.test(c)) return true; // digits/punctuation only: page numbers, stray serials
  if (/^(?:page|pg|p)\s*\d+$/.test(c)) return true;
  if (/^(?:(?:grand|sub)\s+)*total(?:\s+\d[\d,.]*)?$/.test(c)) return true;
  return false;
}
