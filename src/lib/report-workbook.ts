import type { MatchResult, Settings, Status } from "./types.ts";
import {
  computeValuation,
  overpaymentExposure,
  PAIRING_STATUSES,
  valuationFlag,
  type Valuation,
} from "./analysis.ts";

export const STATUS_NAMES: Record<Status, string> = {
  CONFIRMED: "Confirmed match",
  STRONG: "Strong match",
  PROBABLE: "Probable match",
  CONFLICT: "Conflict",
  UNMATCHED: "Unmatched",
};

export interface RunStatsLike {
  total: number;
  CONFIRMED: number;
  STRONG: number;
  PROBABLE: number;
  CONFLICT: number;
  UNMATCHED: number;
  resolvedCodeStrip: Settings["codeStrip"];
}

const FILLS: Record<string, { fg: string; bg: string }> = {
  CONFIRMED: { fg: "FF006100", bg: "FFC6EFCE" },
  STRONG: { fg: "FF00695C", bg: "FFCCF0EE" },
  PROBABLE: { fg: "FF9C6500", bg: "FFFFEB9C" },
  CONFLICT: { fg: "FF9C0006", bg: "FFFFC7CE" },
  UNMATCHED: { fg: "FF3F3F46", bg: "FFE4E4E7" },
};

const STATUS_ORDER: Status[] = [
  "CONFIRMED",
  "STRONG",
  "PROBABLE",
  "CONFLICT",
  "UNMATCHED",
];

const MONEY_FMT = "#,##0.00";
const GAP_FMT = "0.00";
const PCT_FMT = '0.00"%"';
const COUNT_FMT = "#,##0";

const HEADER_FONT: Partial<import("exceljs").Font> = { bold: true, color: { argb: "FFFFFFFF" } };
const HEADER_FILL: import("exceljs").FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF334155" },
};

// ---- Full Audit / Action List table --------------------------------------

const AUDIT_BASE_HEADERS: readonly string[] = [
  "A Row",
  "A Item Name",
  "A Cleaned Name",
  "A Part Codes",
  "A Price",
  "B Row",
  "B Matched Name",
  "B Cleaned Name",
  "B Price",
  "Records",
  "Lowest",
  "Highest",
  "Wtd Avg",
  "Difference",
  "Gap %",
  "Score",
  "Method",
  "Status",
];

export interface QtyMaps {
  aQty: Record<number, number | null>;
  bQty: Record<number, number | null>;
  /** rowNum -> other rowNums in File A with the same description (duplicates) */
  aDups?: Record<number, number[]>;
  /** Every File B row — powers the Adjuster Ledger sheet */
  bRows?: Record<
    number,
    { name: string; price: number | null; qty: number | null; code?: string | null }
  >;
}

export interface ReportOptions {
  /** Depreciation allowance (%) — flags claims above range as explained (ACV). */
  depreciationPct?: number;
}

function hasQtyData(qty?: QtyMaps): boolean {
  return (
    !!qty &&
    (Object.keys(qty.aQty).length > 0 || Object.keys(qty.bQty).length > 0)
  );
}

function hasDupData(qty?: QtyMaps): boolean {
  return !!qty && Object.keys(qty.aDups ?? {}).length > 0;
}

/**
 * Headers + 1-based column indices. The optional Claimed/Assessed Qty pair
 * slots in AFTER "B Cleaned Name" and BEFORE "B Price" — auditRow() pushes its
 * eight leading cells in exactly that order, so headings and cells stay aligned.
 */
function buildLayout(hasJev: boolean, hasQty: boolean, hasDups = false) {
  const headers = [
    ...AUDIT_BASE_HEADERS.slice(0, 8),
    ...(hasQty ? ["Claimed Qty", "Assessed Qty"] : []),
    ...AUDIT_BASE_HEADERS.slice(8),
    ...(hasDups ? ["Duplicate Rows"] : []),
    ...(hasJev ? ["Jev Verdict"] : []),
    "Notes",
  ];
  const col = (name: string) => headers.indexOf(name) + 1;
  return {
    headers,
    colAPrice: col("A Price"),
    colBPrice: col("B Price"),
    colLowest: col("Lowest"),
    colHighest: col("Highest"),
    colWtdAvg: col("Wtd Avg"),
    colRecords: col("Records"),
    colDifference: col("Difference"),
    colGap: col("Gap %"),
    colStatus: col("Status"),
    colQty: hasQty ? col("Claimed Qty") : -1,
    colDup: hasDups ? col("Duplicate Rows") : -1,
  };
}

function gapPercent(r: MatchResult): number | null {
  if (r.aPrice == null || r.difference == null || r.aPrice === 0) return null;
  return (Math.abs(r.difference) / r.aPrice) * 100;
}

function jevCell(r: MatchResult): string {
  if (r.jevVerdict == null) return "";
  if (r.jevConfidence == null) return r.jevVerdict;
  // Confidence may arrive on a 0-1 or 0-100 scale; normalise to percent.
  const pct = r.jevConfidence <= 1 ? r.jevConfidence * 100 : r.jevConfidence;
  return `${r.jevVerdict} · ${Math.min(100, Math.round(pct))}%`;
}

function auditRow(
  r: MatchResult,
  layout: ReturnType<typeof buildLayout>,
  aQty: Record<number, number | null>,
  bQty: Record<number, number | null>,
  aDups: Record<number, number[]> = {},
  valuation?: Valuation,
): (string | number | null)[] {
  const row: (string | number | null)[] = [
    r.aRowNum,
    r.aRawName,
    r.aCleaned,
    r.aCodes.join(", "),
    r.aPrice,
    r.chosen?.bRowNum ?? null,
    r.chosen?.rawName ?? "",
    r.chosen?.cleaned ?? "",
  ];
  if (layout.colQty !== -1) {
    // Claimed/Assessed Qty sit between "B Cleaned Name" and "B Price".
    row.push(aQty[r.aRowNum] ?? null, r.chosen ? (bQty[r.chosen.bRowNum] ?? null) : null);
  }
  row.push(
    r.bPrice,
    valuation?.count ?? null,
    valuation?.lowest ?? null,
    valuation?.highest ?? null,
    valuation?.weightedAvg ?? null,
    r.difference,
    gapPercent(r),
    r.score,
    r.method ?? "",
    STATUS_NAMES[r.status],
  );
  if (layout.colDup !== -1) {
    const dups = aDups[r.aRowNum];
    row.push(dups && dups.length > 0 ? dups.join(", ") : "");
  }
  if (layout.headers.includes("Jev Verdict")) row.push(jevCell(r));
  row.push(r.notes.join(" | ") || "");
  return row;
}

function applyStatusFill(
  row: import("exceljs").Row,
  status: Status,
  colStatus: number,
): void {
  const fill = FILLS[status];
  const statusCell = row.getCell(colStatus);
  statusCell.font = { color: { argb: fill.fg }, bold: true };
  statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill.bg } };
}

interface TableOptions {
  /** zebra striping via a single formula-based conditional format (no per-cell loops) */
  zebra: boolean;
  /** freeze the first column in addition to the header row */
  freezeFirstColumn: boolean;
}

function addTableSheet(
  wb: import("exceljs").Workbook,
  name: string,
  rows: MatchResult[],
  hasJev: boolean,
  opts: TableOptions,
  qty: QtyMaps | undefined,
  valuation: Map<number, Valuation>,
): void {
  const ws = wb.addWorksheet(name);
  const layout = buildLayout(hasJev, hasQtyData(qty), hasDupData(qty));
  const headers = layout.headers;
  const aQty = qty?.aQty ?? {};
  const bQty = qty?.bQty ?? {};
  const aDups = qty?.aDups ?? {};
  ws.columns = headers.map((h) => ({ header: h, key: h, width: 18 }));
  ws.getRow(1).font = HEADER_FONT;
  ws.getRow(1).fill = HEADER_FILL;
  ws.views = [
    { state: "frozen", ySplit: 1, ...(opts.freezeFirstColumn ? { xSplit: 1 } : {}) },
  ];

  // Column-level number formats: applied once, inherited by every data cell.
  ws.getColumn(layout.colAPrice).numFmt = MONEY_FMT;
  ws.getColumn(layout.colBPrice).numFmt = MONEY_FMT;
  ws.getColumn(layout.colLowest).numFmt = MONEY_FMT;
  ws.getColumn(layout.colHighest).numFmt = MONEY_FMT;
  ws.getColumn(layout.colWtdAvg).numFmt = MONEY_FMT;
  ws.getColumn(layout.colRecords).numFmt = COUNT_FMT;
  ws.getColumn(layout.colDifference).numFmt = MONEY_FMT;
  ws.getColumn(layout.colGap).numFmt = GAP_FMT;
  if (layout.colQty !== -1) {
    ws.getColumn(layout.colQty).numFmt = "#,##0.##";
    ws.getColumn(layout.colQty + 1).numFmt = "#,##0.##";
    ws.getColumn(layout.colQty).width = 12;
    ws.getColumn(layout.colQty + 1).width = 12;
  }
  ws.getColumn(2).width = 46;
  ws.getColumn(3).width = 40;
  ws.getColumn(7).width = 46;
  ws.getColumn(8).width = 40;
  if (hasJev) ws.getColumn(headers.length - 1).width = 16;
  ws.getColumn(headers.length).width = 52; // Notes — widened so full text is readable

  // AutoFilter over the header row: Excel extends it to the data region on use.
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

  for (const r of rows) {
    const row = ws.addRow(auditRow(r, layout, aQty, bQty, aDups, valuation.get(r.id)));
    applyStatusFill(row, r.status, layout.colStatus);
  }

  if (opts.zebra && rows.length > 0) {
    ws.addConditionalFormatting({
      ref: `A2:${ws.getColumn(headers.length).letter}${rows.length + 1}`,
      rules: [
        {
          type: "expression",
          priority: 1,
          formulae: ["MOD(ROW(),2)=0"],
          style: {
            fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFF3F4F6" } },
          },
        },
      ],
    });
  }
}

// ---- Price Summary ---------------------------------------------------------

interface StatusMoney {
  items: number;
  sumA: number | null;
  sumB: number | null;
  sumDiff: number | null;
}

interface PriceStats {
  hasJev: boolean;
  totalA: number | null;
  totalB: number | null;
  netDifference: number | null;
  totalAbsDifference: number | null;
  avgGapPct: number | null;
  maxGapPct: number | null;
  inRangeItems: number;
  aboveRangeItems: number;
  aboveRangeAmount: number | null;
  aboveAllowedItems: number;
  belowRangeItems: number;
  unpricedItems: number;
  byStatus: Record<Status, StatusMoney>;
}

const addTo = (sum: number | null, v: number): number => (sum ?? 0) + v;

/** Single O(n) pass over results computing every Price Summary figure. */
function computePriceStats(
  results: MatchResult[],
  valuation: Map<number, Valuation>,
  depreciationPct: number,
): PriceStats {
  const byStatus = Object.fromEntries(
    STATUS_ORDER.map((s) => [s, { items: 0, sumA: null, sumB: null, sumDiff: null }]),
  ) as Record<Status, StatusMoney>;

  let hasJev = false;
  let totalA: number | null = null;
  let totalB: number | null = null;
  let totalAbsDifference: number | null = null;
  let gapSum = 0;
  let gapCount = 0;
  let maxGapPct: number | null = null;
  let inRangeItems = 0;
  let aboveRangeItems = 0;
  let aboveRangeAmount: number | null = null;
  let aboveAllowedItems = 0;
  let belowRangeItems = 0;
  let unpricedItems = 0;

  for (const r of results) {
    if (r.jevVerdict != null) hasJev = true;
    const s = byStatus[r.status];
    s.items++;
    if (r.aPrice != null) {
      totalA = addTo(totalA, r.aPrice);
      s.sumA = addTo(s.sumA, r.aPrice);
    }
    if (r.bPrice != null) {
      totalB = addTo(totalB, r.bPrice);
      s.sumB = addTo(s.sumB, r.bPrice);
    }
    if (r.difference != null) {
      totalAbsDifference = addTo(totalAbsDifference, Math.abs(r.difference));
      s.sumDiff = addTo(s.sumDiff, r.difference);
      if (r.aPrice != null && r.aPrice !== 0) {
        const gap = (Math.abs(r.difference) / r.aPrice) * 100;
        gapSum += gap;
        gapCount++;
        if (maxGapPct == null || gap > maxGapPct) maxGapPct = gap;
      }
    }
    // Valuation position vs the costing evidence range.
    const flag = valuationFlag(valuation.get(r.id), r.aPrice, depreciationPct);
    if (flag === "in-range") inRangeItems++;
    else if (flag === "above") aboveRangeItems++;
    else if (flag === "above-allowed") aboveAllowedItems++;
    else if (flag === "below") belowRangeItems++;
    else unpricedItems++;
  }

  const exposure = overpaymentExposure(results, valuation, depreciationPct);
  aboveRangeAmount = exposure.count > 0 ? exposure.amount : null;

  return {
    hasJev,
    totalA,
    totalB,
    netDifference: totalB != null || totalA != null ? (totalB ?? 0) - (totalA ?? 0) : null,
    totalAbsDifference,
    avgGapPct: gapCount > 0 ? gapSum / gapCount : null,
    maxGapPct,
    inRangeItems,
    aboveRangeItems,
    aboveRangeAmount,
    aboveAllowedItems,
    belowRangeItems,
    unpricedItems,
    byStatus,
  };
}

const QUALIFICATION_NOTES: readonly string[] = [
  "Model: identity (same item?), quantity and valuation are separate tests. Identity is established by part/model number and description structure; fuzzy name similarity only suggests candidates and never decides identity.",
  "Valuation evidence: every costing record linked to an identified item is collected. The range (lowest–highest) and qty-weighted average are shown; no price is auto-accepted. Establish the insured's actual valuation basis and the policy-permitted basis before setting an accepted cost.",
  "Documentary qualification: the inventory declares 'Specific Identification', but the workbook carries no item/lot identifiers that would allow tracing a line to a specific purchase cost. Request purchase invoices, purchase journal, stock/bin cards, receiving reports and the inventory subsidiary ledger; do not accept the declaration as proof of costing method without that support.",
  "Zero-price costing lines: costing rows with a zero or unreadable unit price are counted as identity evidence but excluded from price ranges — a missing price is not a low price.",
];

function addPriceSummarySheet(wb: import("exceljs").Workbook, ps: PriceStats): void {
  const ws = wb.addWorksheet("Price Summary");
  ws.columns = [{ width: 50 }, { width: 20 }, { width: 18 }, { width: 18 }, { width: 18 }];

  const paintHeader = (row: import("exceljs").Row): void => {
    row.font = HEADER_FONT;
    row.fill = HEADER_FILL;
  };

  ws.addRow(["Metric", "Value"]);
  paintHeader(ws.getRow(1));

  const addMoney = (label: string, value: number | null, bold = false): void => {
    const row = ws.addRow([label, value]);
    row.getCell(2).numFmt = MONEY_FMT;
    if (bold) row.font = { bold: true };
  };
  const addCount = (label: string, value: number): void => {
    const row = ws.addRow([label, value]);
    row.getCell(2).numFmt = COUNT_FMT;
  };
  const addPct = (label: string, value: number | null): void => {
    const row = ws.addRow([label, value]);
    row.getCell(2).numFmt = PCT_FMT;
  };

  addMoney("Total A value (Σ A)", ps.totalA);
  addMoney("Total B value (Σ B, chosen records)", ps.totalB);
  addMoney("Net difference (B − A)", ps.netDifference);
  addMoney("Total absolute difference", ps.totalAbsDifference);
  addPct("Average gap % (|B − A| ÷ A)", ps.avgGapPct);
  addPct("Largest gap %", ps.maxGapPct);
  ws.addRow([]);
  addCount("Claimed price inside costing range", ps.inRangeItems);
  addCount("Claimed ABOVE range — potential overpayment", ps.aboveRangeItems);
  addCount("…of which explained by depreciation allowance", ps.aboveAllowedItems);
  addMoney("Overpayment exposure (Σ claimed − highest, above-range only)", ps.aboveRangeAmount, true);
  addCount("Claimed BELOW range", ps.belowRangeItems);
  addCount("Rows without usable costing prices", ps.unpricedItems);

  ws.addRow([]);

  ws.addRow(["Status", "Items", "Σ A", "Σ B", "Σ Difference"]);
  paintHeader(ws.getRow(ws.rowCount));
  for (const status of STATUS_ORDER) {
    const s = ps.byStatus[status];
    const row = ws.addRow([STATUS_NAMES[status], s.items, s.sumA, s.sumB, s.sumDiff]);
    row.getCell(2).numFmt = COUNT_FMT;
    row.getCell(3).numFmt = MONEY_FMT;
    row.getCell(4).numFmt = MONEY_FMT;
    row.getCell(5).numFmt = MONEY_FMT;
    row.getCell(1).font = { color: { argb: FILLS[status].fg }, bold: true };
  }

  ws.addRow([]);
  ws.addRow(["How to read this report", ""]);
  paintHeader(ws.getRow(ws.rowCount));
  for (const note of QUALIFICATION_NOTES) {
    const row = ws.addRow(["", note]);
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
  }
}

// ---- Summary ---------------------------------------------------------------

function addSummarySheet(
  wb: import("exceljs").Workbook,
  stats: RunStatsLike,
  settings: Settings,
  fileNames: { a: string; b: string } | null,
  runAt: Date,
): void {
  const sum = wb.addWorksheet("Summary");
  sum.columns = [{ width: 26 }, { width: 46 }];
  const kv: [string, string | number][] = [
    ["Generated", runAt.toLocaleString()],
    ["Run timestamp (UTC)", runAt.toISOString()],
    ["File A (inventory/claim)", fileNames?.a ?? "—"],
    ["File B (costing/prices)", fileNames?.b ?? "—"],
    ["File A items", stats.total],
    ["Confirmed matches", stats.CONFIRMED],
    ["Strong matches", stats.STRONG],
    ["Probable matches", stats.PROBABLE],
    ["Conflicts", stats.CONFLICT],
    ["Unmatched", stats.UNMATCHED],
    ["Settings", ""],
    ["Review floor (fuzzy kept as Probable)", settings.reviewFloor],
    ["Reference gap tolerance (%)", settings.priceTolerance],
    [
      "Code stripping (name comparison only)",
      settings.codeStrip.mode === "regex"
        ? `regex: ${settings.codeStrip.regex}`
        : settings.codeStrip.mode === "auto"
          ? `auto → ${stats.resolvedCodeStrip.mode}`
          : settings.codeStrip.mode,
    ],
  ];
  for (const [k, v] of kv) {
    const row = sum.addRow([k, v]);
    row.getCell(1).font = { bold: true };
  }
  // Colour the five status-count value cells with the status fill colours.
  for (let i = 6; i <= 10; i++) {
    sum.getCell(`B${i}`).font = {
      color: { argb: FILLS[STATUS_ORDER[i - 6]].fg },
    };
  }
  sum.addRow([]);
  sum.addRow(["Identification & valuation model", ""]);
  const modelHeader = sum.getRow(sum.rowCount);
  modelHeader.font = HEADER_FONT;
  modelHeader.fill = HEADER_FILL;
  for (const note of QUALIFICATION_NOTES) {
    const row = sum.addRow(["", note]);
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
  }
  sum.addRow([]);
  const footer = sum.addRow([
    "Generated by Price Verifier — all matching ran in the browser",
  ]);
  footer.getCell(1).font = { italic: true, color: { argb: "FF6B7280" } };
}

/**
 * Build the report workbook (Summary / Price Summary / Full Audit / Action
 * List / Adjuster Ledger). DOM-free so it can be unit-tested in Node;
 * downloadReport() wraps it for the browser.
 */
export async function buildReportBuffer(
  results: MatchResult[],
  stats: RunStatsLike,
  settings: Settings,
  fileNames: { a: string; b: string } | null,
  qty?: QtyMaps,
  options?: ReportOptions,
): Promise<import("exceljs").Buffer> {
  const mod = await import("exceljs");
  // exceljs is CJS: Node gives { default: { Workbook } }, bundlers name-scope it.
  const Workbook = mod.Workbook ?? mod.default?.Workbook;
  const wb = new Workbook();
  const runAt = new Date();
  wb.creator = "Price Verifier";
  wb.created = runAt;

  addSummarySheet(wb, stats, settings, fileNames, runAt);

  const valuation = computeValuation(results, qty?.bQty ?? {});
  const priceStats = computePriceStats(results, valuation, options?.depreciationPct ?? 0);
  addPriceSummarySheet(wb, priceStats);

  addTableSheet(wb, "Full Audit", results, priceStats.hasJev, {
    zebra: true,
    freezeFirstColumn: true,
  }, qty, valuation);

  const problems = results.filter((r) => r.status !== "CONFIRMED" && r.status !== "STRONG");
  addTableSheet(wb, "Action List", problems, priceStats.hasJev, {
    zebra: false,
    freezeFirstColumn: false,
  }, qty, valuation);

  addAdjusterLedgerSheet(wb, results, qty);

  return wb.xlsx.writeBuffer();
}

/**
 * Adjuster Ledger sheet: EVERY File B row listed — paired with the claim row(s)
 * it supports, or unmatched. Guarantees neither file is dropped from the
 * report: the claim side is the Full Audit, the costing side is this sheet.
 */
function addAdjusterLedgerSheet(
  wb: import("exceljs").Workbook,
  results: MatchResult[],
  qty?: QtyMaps,
): void {
  const bRows = qty?.bRows ?? {};
  if (Object.keys(bRows).length === 0) return;
  const aQty = qty?.aQty ?? {};

  // B row -> claim rows whose ESTABLISHED identity references it (candidates
  // of Confirmed/Strong rows). Probable leads and conflicts don't count yet.
  const supportsByB = new Map<number, { aRows: number[]; aNames: string[] }>();
  for (const r of results) {
    if (!PAIRING_STATUSES.includes(r.status)) continue;
    const ref = r.chosen;
    const nums = new Set<number>(r.candidates.map((c) => c.bRowNum));
    if (ref) nums.add(ref.bRowNum);
    for (const bn of nums) {
      let entry = supportsByB.get(bn);
      if (!entry) {
        entry = { aRows: [], aNames: [] };
        supportsByB.set(bn, entry);
      }
      if (!entry.aRows.includes(r.aRowNum)) {
        entry.aRows.push(r.aRowNum);
        entry.aNames.push(r.aRawName);
      }
    }
  }

  const ws = wb.addWorksheet("Adjuster Ledger");
  const headers = ["B Row", "Description", "Part Code", "Claimed Qty", "Assessed Qty", "Unit Price", "Total Cost", "Status", "Supports Claim Rows", "Matched A Items"];
  ws.columns = headers.map((h) => ({ header: h, key: h, width: 18 }));
  ws.getRow(1).font = HEADER_FONT;
  ws.getRow(1).fill = HEADER_FILL;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  ws.getColumn(2).width = 46;
  ws.getColumn(10).width = 46;
  ws.getColumn("Unit Price").numFmt = MONEY_FMT;
  ws.getColumn("Total Cost").numFmt = MONEY_FMT;
  ws.getColumn("Claimed Qty").numFmt = "#,##0.##";
  ws.getColumn("Assessed Qty").numFmt = "#,##0.##";

  for (const [numStr, row] of Object.entries(bRows)) {
    const rowNum = Number(numStr);
    const s = supportsByB.get(rowNum);
    const firstARow = s?.aRows[0] ?? null;
    const claimedQty = firstARow !== null ? (aQty[firstARow] ?? null) : null;
    const ext = row.qty != null && row.price != null
      ? Math.round(row.qty * row.price * 100) / 100
      : row.price;
    const r = ws.addRow([
      rowNum,
      row.name,
      row.code ?? "",
      claimedQty,
      row.qty ?? null,
      row.price,
      ext,
      s ? `Paired → A${s.aRows.join(", A")}` : "Unmatched",
      s ? s.aRows.join(", ") : "",
      s ? s.aNames.join(" | ") : "",
    ]);
    const statusCell = r.getCell("Status");
    statusCell.font = s
      ? { color: { argb: "FF006100" }, bold: true }
      : { color: { argb: "FF9C6500" }, bold: true };
    statusCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: s ? "FFC6EFCE" : "FFFFEB9C" },
    };
  }
}
