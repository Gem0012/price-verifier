export type Status =
  | "MATCH"
  | "MISMATCH"
  | "MULTIPLE"
  | "NEEDS_REVIEW"
  | "NOT_FOUND";

export const STATUS_LABELS: Record<Status, string> = {
  MATCH: "Match",
  MISMATCH: "Mismatch",
  MULTIPLE: "Multiple matches",
  NEEDS_REVIEW: "Needs review",
  NOT_FOUND: "Not found",
};

export type MatchMethod = "exact" | "fuzzy" | "manual" | "jev" | null;

export type JevVerdict = "MATCH" | "NOT_MATCH" | "UNCERTAIN";

export interface Candidate {
  bRowNum: number;
  rawName: string;
  cleaned: string;
  rawPrice: unknown;
  price: number | null;
  similarity: number;
}

export interface MatchResult {
  id: number;
  aRowNum: number;
  aRawName: string;
  aCleaned: string;
  aRawPrice: unknown;
  aPrice: number | null;
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
  /** similarity (0-100) at or above which a fuzzy candidate is auto-accepted */
  autoAccept: number;
  /** similarity (0-100) below which (except for the single best candidate) matches are not kept */
  reviewFloor: number;
  /** |A price - B price| <= (tolerance% of the A price) counts as MATCH */
  priceTolerance: number;
  codeStrip: CodeStripConfig;
}

export const DEFAULT_SETTINGS: Settings = {
  autoAccept: 90,
  reviewFloor: 60,
  priceTolerance: 0,
  codeStrip: { mode: "auto" },
};
