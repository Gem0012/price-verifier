import type { MatchResult, Settings } from "@/lib/types";

export const STATUS_NAMES: Record<MatchResult["status"], string> = {
  MATCH: "Match",
  MISMATCH: "Mismatch",
  MULTIPLE: "Multiple matches",
  NEEDS_REVIEW: "Needs review",
  NOT_FOUND: "Not found",
};

export interface RunStatsLike {
  total: number;
  MATCH: number;
  MISMATCH: number;
  MULTIPLE: number;
  NEEDS_REVIEW: number;
  NOT_FOUND: number;
  resolvedCodeStrip: Settings["codeStrip"];
}

const FILLS: Record<string, { fg: string; bg: string }> = {
  MATCH: { fg: "FF006100", bg: "FFC6EFCE" },
  MISMATCH: { fg: "FF9C0006", bg: "FFFFC7CE" },
  MULTIPLE: { fg: "FF9C6500", bg: "FFFFEB9C" },
  NEEDS_REVIEW: { fg: "FF9C6500", bg: "FFFFEB9C" },
  NOT_FOUND: { fg: "FF3F3F46", bg: "FFE4E4E7" },
};

const STATUS_ORDER: MatchResult["status"][] = [
  "MATCH",
  "MISMATCH",
  "MULTIPLE",
  "NEEDS_REVIEW",
  "NOT_FOUND",
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
  "A Price",
  "B Row",
  "B Matched Name",
  "B Cleaned Name",
  "B Price",
  "Difference",
  "Gap %",
  "Score",
  "Method",
  "Status",
];

// 1-based column indices are computed per-sheet by buildLayout() — they shift
// when the optional Qty / Jev Verdict columns are present.

export interface QtyMaps {
  aQty: Record<number, number | null>;
  bQty: Record<number, number | null>;
}

function hasQtyData(qty?: QtyMaps): boolean {
  return (
    !!qty &&
    (Object.keys(qty.aQty).length > 0 || Object.keys(qty.bQty).length > 0)
  );
}

/** Headers + 1-based column indices; qty columns slot in before B Price. */
function buildLayout(hasJev: boolean, hasQty: boolean) {
  const headers = [
    ...AUDIT_BASE_HEADERS.slice(0, 7),
    ...(hasQty ? ["Claimed Qty", "Assessed Qty"] : []),
    ...AUDIT_BASE_HEADERS.slice(7),
    ...(hasJev ? ["Jev Verdict"] : []),
    "Notes",
  ];
  const col = (name: string) => headers.indexOf(name) + 1;
  return {
    headers,
    colAPrice: col("A Price"),
    colBPrice: col("B Price"),
    colDifference: col("Difference"),
    colGap: col("Gap %"),
    colStatus: col("Status"),
    colQty: hasQty ? col("Claimed Qty") : -1,
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
): (string | number | null)[] {
  const row: (string | number | null)[] = [
    r.aRowNum,
    r.aRawName,
    r.aCleaned,
    r.aPrice,
    r.chosen?.bRowNum ?? null,
    r.chosen?.rawName ?? "",
    r.chosen?.cleaned ?? "",
  ];
  if (layout.colQty !== -1) {
    row.push(aQty[r.aRowNum] ?? null, r.chosen ? (bQty[r.chosen.bRowNum] ?? null) : null);
  }
  row.push(
    r.bPrice,
    r.difference,
    gapPercent(r),
    r.score,
    r.method ?? "",
    STATUS_NAMES[r.status],
  );
  if (layout.headers.includes("Jev Verdict")) row.push(jevCell(r));
  row.push(r.notes.join(" | ") || "");
  return row;
}

function applyStatusFill(
  row: import("exceljs").Row,
  status: MatchResult["status"],
  colStatus: number,
  colDifference: number,
): void {
  const fill = FILLS[status];
  const statusCell = row.getCell(colStatus);
  statusCell.font = { color: { argb: fill.fg }, bold: true };
  statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill.bg } };
  if (status === "MISMATCH") {
    row.getCell(colDifference).font = { color: { argb: fill.fg }, bold: true };
  }
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
  qty?: QtyMaps,
): void {
  const ws = wb.addWorksheet(name);
  const layout = buildLayout(hasJev, hasQtyData(qty));
  const headers = layout.headers;
  const aQty = qty?.aQty ?? {};
  const bQty = qty?.bQty ?? {};
  ws.columns = headers.map((h) => ({ header: h, key: h, width: 18 }));
  ws.getRow(1).font = HEADER_FONT;
  ws.getRow(1).fill = HEADER_FILL;
  ws.views = [
    { state: "frozen", ySplit: 1, ...(opts.freezeFirstColumn ? { xSplit: 1 } : {}) },
  ];

  // Column-level number formats: applied once, inherited by every data cell.
  ws.getColumn(layout.colAPrice).numFmt = MONEY_FMT;
  ws.getColumn(layout.colBPrice).numFmt = MONEY_FMT;
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
  ws.getColumn(6).width = 46;
  ws.getColumn(7).width = 40;
  if (hasJev) ws.getColumn(headers.length - 1).width = 16;
  ws.getColumn(headers.length).width = 52; // Notes — widened so full text is readable

  // AutoFilter over the header row: Excel extends it to the data region on use.
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

  for (const r of rows) {
    const row = ws.addRow(auditRow(r, layout, aQty, bQty));
    applyStatusFill(row, r.status, layout.colStatus, layout.colDifference);
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
  moreItems: number;
  moreAmount: number | null;
  lessItems: number;
  lessAmount: number | null;
  equalItems: number;
  overpayExposure: number | null;
  underchargeExposure: number | null;
  byStatus: Record<MatchResult["status"], StatusMoney>;
}

const addTo = (sum: number | null, v: number): number => (sum ?? 0) + v;

/** Single O(n) pass over results computing every Price Summary figure. */
function computePriceStats(results: MatchResult[]): PriceStats {
  const byStatus = Object.fromEntries(
    STATUS_ORDER.map((s) => [s, { items: 0, sumA: null, sumB: null, sumDiff: null }]),
  ) as Record<MatchResult["status"], StatusMoney>;

  let hasJev = false;
  let totalA: number | null = null;
  let totalB: number | null = null;
  let totalAbsDifference: number | null = null;
  let gapSum = 0;
  let gapCount = 0;
  let maxGapPct: number | null = null;
  let moreItems = 0;
  let moreAmount: number | null = null;
  let lessItems = 0;
  let lessAmount: number | null = null;
  let equalItems = 0;
  let overpayExposure: number | null = null;
  let underchargeExposure: number | null = null;

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
    if (r.aPrice != null && r.bPrice != null) {
      const a = r.aPrice;
      const b = r.bPrice;
      const diff = r.difference;
      if (b > a) {
        moreItems++;
        if (diff != null) moreAmount = addTo(moreAmount, diff);
      } else if (b < a) {
        lessItems++;
        if (diff != null) lessAmount = addTo(lessAmount, -diff);
      } else {
        equalItems++;
      }
      if (r.status === "MISMATCH" && diff != null) {
        if (b > a) overpayExposure = addTo(overpayExposure, diff);
        else if (b < a) underchargeExposure = addTo(underchargeExposure, -diff);
      }
    }
  }

  return {
    hasJev,
    totalA,
    totalB,
    netDifference: totalB != null || totalA != null ? (totalB ?? 0) - (totalA ?? 0) : null,
    totalAbsDifference,
    avgGapPct: gapCount > 0 ? gapSum / gapCount : null,
    maxGapPct,
    moreItems,
    moreAmount,
    lessItems,
    lessAmount,
    equalItems,
    overpayExposure,
    underchargeExposure,
    byStatus,
  };
}

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
  addMoney("Total B value (Σ B)", ps.totalB);
  addMoney("Net difference (B − A)", ps.netDifference);
  addMoney("Total absolute difference", ps.totalAbsDifference);
  addPct("Average gap % (|B − A| ÷ A)", ps.avgGapPct);
  addPct("Largest gap %", ps.maxGapPct);
  addCount("B costs more — items", ps.moreItems);
  addMoney("B costs more — Σ (B − A)", ps.moreAmount);
  addCount("B costs less — items", ps.lessItems);
  addMoney("B costs less — Σ (A − B)", ps.lessAmount);
  addCount("Prices equal — items", ps.equalItems);
  addMoney("Mismatch exposure — potential overpayment (Σ B − A)", ps.overpayExposure, true);
  addMoney("Mismatch exposure — potential undercharge (Σ A − B)", ps.underchargeExposure, true);

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
    ["File A (masterlist)", fileNames?.a ?? "—"],
    ["File B (prices)", fileNames?.b ?? "—"],
    ["File A items", stats.total],
    ["Match", stats.MATCH],
    ["Mismatch", stats.MISMATCH],
    ["Multiple matches", stats.MULTIPLE],
    ["Needs review", stats.NEEDS_REVIEW],
    ["Not found", stats.NOT_FOUND],
    ["Settings", ""],
    ["Auto-accept cutoff", settings.autoAccept],
    ["Review floor", settings.reviewFloor],
    ["Price tolerance (%)", settings.priceTolerance],
    [
      "Code stripping",
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
  const footer = sum.addRow([
    "Generated by Price Verifier — all matching ran in the browser",
  ]);
  footer.getCell(1).font = { italic: true, color: { argb: "FF6B7280" } };
}

/**
 * Build the 4-sheet report workbook (Summary / Price Summary / Full Audit / Action List).
 * DOM-free so it can be unit-tested in Node; downloadReport() wraps it for the browser.
 */
export async function buildReportBuffer(
  results: MatchResult[],
  stats: RunStatsLike,
  settings: Settings,
  fileNames: { a: string; b: string } | null,
  qty?: QtyMaps,
): Promise<import("exceljs").Buffer> {
  const mod = await import("exceljs");
  // exceljs is CJS: Node gives { default: { Workbook } }, bundlers name-scope it.
  const Workbook = mod.Workbook ?? mod.default?.Workbook;
  const wb = new Workbook();
  const runAt = new Date();
  wb.creator = "Price Verifier";
  wb.created = runAt;

  addSummarySheet(wb, stats, settings, fileNames, runAt);

  const priceStats = computePriceStats(results);
  addPriceSummarySheet(wb, priceStats);

  addTableSheet(wb, "Full Audit", results, priceStats.hasJev, {
    zebra: true,
    freezeFirstColumn: true,
  }, qty);

  const problems = results.filter((r) => r.status !== "MATCH");
  addTableSheet(wb, "Action List", problems, priceStats.hasJev, {
    zebra: false,
    freezeFirstColumn: false,
  }, qty);

  return wb.xlsx.writeBuffer();
}
