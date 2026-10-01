export type Status =
  | "CONFIRMED"
  | "STRONG"
  | "PROBABLE"
  | "CONFLICT"
  | "UNMATCHED";

export const STATUS_LABELS: Record<Status, string> = {
  CONFIRMED: "Confirmed match",
  STRONG: "Strong match",
  PROBABLE: "Probable match",
  CONFLICT: "Conflict",
  UNMATCHED: "Unmatched",
};

export type MatchMethod = "code" | "exact" | "fuzzy" | "manual" | "jev" | null;

export type JevVerdict = "MATCH" | "NOT_MATCH" | "UNCERTAIN";

export interface Candidate {
  bRowNum: number;
  rawName: string;
  cleaned: string;
  rawPrice: unknown;
  price: number | null;
  similarity: number;
  /** Part/model code that linked this candidate to the row (code-matched only). */
  matchedCode?: string | null;
}

export interface MatchResult {
  id: number;
  aRowNum: number;
  aRawName: string;
  aCleaned: string;
  aRawPrice: unknown;
  aPrice: number | null;
  /** Part/model codes extracted from the File A description (and code column). */
  aCodes: string[];
  status: Status;
  method: MatchMethod;
  score: number | null;
  candidates: Candidate[];
  chosen: Candidate | null;
  bPrice: number | null;
  difference: number | null;
  jevVerdict: JevVerdict | null;
  jevConfidence: number | null;
  notes: string[];
}

export interface ColumnMapping {
  sheetName: string;
  headerRow: number;
  nameCol: number;
  priceCol: number;
  /** Auto-detected part/model/SKU code column, when one exists. */
  codeCol: number | null;
}

export interface SheetColumn {
  index: number;
  label: string;
  samples: string[];
  stringRatio: number;
  numericRatio: number;
}

export interface AnalyzedSheet {
  name: string;
  headerRow: number;
  columns: SheetColumn[];
  mapping: ColumnMapping;
  dataRowCount: number;
  previewRows: unknown[][];
}

export interface AnalyzedFile {
  fileName: string;
  sheets: AnalyzedSheet[];
}

export type CodeStripMode = "auto" | "none" | "firstToken" | "lastToken" | "regex";

export interface CodeStripConfig {
  mode: CodeStripMode;
  regex?: string;
}

export interface Settings {
  /**
   * Fuzzy scores at or above this are kept as Probable-match candidates for
   * review. Fuzzy matching NEVER auto-accepts — it only suggests (identity is
   * decided by part numbers, exact descriptions, or a human).
   */
  reviewFloor: number;
  /** |A price − B price| shown as the gap for the chosen reference record. */
  priceTolerance: number;
  codeStrip: CodeStripConfig;
}

export const DEFAULT_SETTINGS: Settings = {
  reviewFloor: 60,
  priceTolerance: 0,
  codeStrip: { mode: "auto" },
};
