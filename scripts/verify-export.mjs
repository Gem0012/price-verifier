// Export verification: node scripts/verify-export.mjs
// Rebuilds the dashboard's Excel report from the answer key + engine and
// checks the resulting workbook: 4 sheets (Summary / Price Summary / Full Audit /
// Action List), correct counts, Price Summary totals, Gap % column, autofilter,
// zebra striping, freeze panes, and number formats.
import { runMatching } from "../src/lib/matching.ts";
import { DEFAULT_SETTINGS } from "../src/lib/types.ts";
import { buildReportBuffer } from "../src/lib/report-workbook.ts";
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";

const key = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "dummy-answer-key.json"), "utf8"),
);

// Reconstruct MatchResult-like rows from the answer key (same shape the app keeps).
const results = key.items.map((it, i) => ({
  id: i,
  aRowNum: it.aRowNum,
  aRawName: `${it.code} ${it.name}`,
  aCleaned: it.name.toLowerCase(),
  aRawPrice: it.aPrice,
  aPrice: it.aPrice,
  status: it.actual,
  method: it.method,
  score: it.score,
  candidates: [],
  chosen: it.bName
    ? { bRowNum: it.bRowNum, rawName: it.bName, cleaned: "", rawPrice: it.bPrice, price: it.bPrice, similarity: it.score ?? 100 }
    : null,
  bPrice: it.bPrice,
  difference: it.bPrice != null && it.aPrice != null ? Math.round((it.bPrice - it.aPrice) * 100) / 100 : null,
  jevVerdict: null,
  jevConfidence: null,
  notes: [],
}));

const stats = {
  total: results.length,
  MATCH: results.filter((r) => r.status === "MATCH").length,
  MISMATCH: results.filter((r) => r.status === "MISMATCH").length,
  MULTIPLE: results.filter((r) => r.status === "MULTIPLE").length,
  NEEDS_REVIEW: results.filter((r) => r.status === "NEEDS_REVIEW").length,
  NOT_FOUND: results.filter((r) => r.status === "NOT_FOUND").length,
  resolvedCodeStrip: { mode: "firstToken" },
};
console.log("stats from key:", stats);

// Answer-key totals the Price Summary sheet must reproduce.
let keySumA = 0;
let keySumB = 0;
for (const it of key.items) {
  if (it.aPrice != null) keySumA += it.aPrice;
  if (it.bPrice != null) keySumB += it.bPrice;
}
keySumA = Math.round(keySumA * 100) / 100;
keySumB = Math.round(keySumB * 100) / 100;

const buf = await buildReportBuffer(results, stats, DEFAULT_SETTINGS, {
  a: "masterlist.xlsx",
  b: "price_file_to_verify.xlsx",
});

const outPath = path.join(import.meta.dirname, "verify-export.xlsx");
fs.writeFileSync(outPath, buf);

const wb = XLSX.read(fs.readFileSync(outPath), { type: "buffer", cellNF: true });
let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name} ${detail}`);
  }
};

// ---- sheet structure -------------------------------------------------------
const SHEET_NAMES = ["Summary", "Price Summary", "Full Audit", "Action List"];
check("4 sheets", wb.SheetNames.length === 4, wb.SheetNames.join(","));
check("sheet names & order", JSON.stringify(wb.SheetNames) === JSON.stringify(SHEET_NAMES), wb.SheetNames.join(","));

const audit = XLSX.utils.sheet_to_json(wb.Sheets["Full Audit"], { header: 1 });
check("Full Audit rows = 5001 (header + 5000)", audit.length === 5001, String(audit.length));
const action = XLSX.utils.sheet_to_json(wb.Sheets["Action List"], { header: 1 });
check("Action List rows = 1 + problems", action.length === 1 + stats.MISMATCH + stats.MULTIPLE + stats.NEEDS_REVIEW + stats.NOT_FOUND, String(action.length));

// ---- audit table columns ---------------------------------------------------
const auditHeader = audit[0];
const gapIdx = auditHeader.indexOf("Gap %");
check("Gap % column present (index 9, after Difference)", gapIdx === 9, JSON.stringify(auditHeader));
check("Gap % column in Action List too", action[0].indexOf("Gap %") === 9);
const jevIdx = auditHeader.indexOf("Jev Verdict");
check("no Jev column when no row has a verdict", jevIdx === -1);
check("Status column at index 12", auditHeader[12] === "Status");

// gap % spot check on the first MISMATCH row of the key
const keyMismatch = key.items.find((it) => it.actual === "MISMATCH");
const auditRow = audit.find((r) => r[0] === keyMismatch.aRowNum);
const expectedGap = (Math.abs(keyMismatch.bPrice - keyMismatch.aPrice) / keyMismatch.aPrice) * 100;
check(
  "audit row carries A name + B name + status",
  auditRow && String(auditRow[1]).includes(keyMismatch.name) && auditRow[12] === "Mismatch",
  JSON.stringify(auditRow?.slice(0, 3)),
);
check(
  "Gap % value = |difference|/aPrice*100",
  auditRow && typeof auditRow[gapIdx] === "number" && Math.abs(auditRow[gapIdx] - expectedGap) < 1e-6,
  `got ${auditRow?.[gapIdx]} want ${expectedGap}`,
);
const keyNotFound = key.items.find((it) => it.actual === "NOT_FOUND" && it.aPrice != null);
const notFoundRow = audit.find((r) => r[0] === keyNotFound.aRowNum);
check("Gap % blank when no prices", notFoundRow && notFoundRow[gapIdx] == null, String(notFoundRow?.[gapIdx]));

// ---- autofilter + number formats -------------------------------------------
for (const name of ["Full Audit", "Action List"]) {
  const af = wb.Sheets[name]["!autofilter"];
  check(`${name} autofilter over header row`, !!af && typeof af.ref === "string" && af.ref.startsWith("A1:"), JSON.stringify(af));
}
// Number formats: check a value-bearing data row (SheetJS omits z for empty cells).
const auditCells = wb.Sheets["Full Audit"];
const pricedRowIdx = audit.findIndex((r) => r[0] !== "A Row" && r[7] != null && r[9] != null);
check("found a priced data row to inspect", pricedRowIdx > 0, String(pricedRowIdx));
const xr = pricedRowIdx + 1; // 1-based Excel row number
check("A Price cell numFmt #,##0.00", auditCells[`D${xr}`]?.z === "#,##0.00", String(auditCells[`D${xr}`]?.z));
check("B Price cell numFmt #,##0.00", auditCells[`H${xr}`]?.z === "#,##0.00", String(auditCells[`H${xr}`]?.z));
check("Difference cell numFmt #,##0.00", auditCells[`I${xr}`]?.z === "#,##0.00", String(auditCells[`I${xr}`]?.z));
check("Gap % cell numFmt 0.00", auditCells[`J${xr}`]?.z === "0.00", String(auditCells[`J${xr}`]?.z));

// ---- Price Summary ---------------------------------------------------------
const price = XLSX.utils.sheet_to_json(wb.Sheets["Price Summary"], { header: 1 });
const priceMap = new Map(
  price.filter((r) => r.length > 0 && typeof r[0] === "string" && r[0] !== "Metric").map((r) => [r[0], r[1]]),
);
const totalA = priceMap.get("Total A value (Σ A)");
const totalB = priceMap.get("Total B value (Σ B)");
const netDiff = priceMap.get("Net difference (B − A)");
const totalAbs = priceMap.get("Total absolute difference");
check("Price Summary total A = answer key Σ aPrice (±0.01)", typeof totalA === "number" && Math.abs(totalA - keySumA) < 0.01, `got ${totalA} want ${keySumA}`);
check("Price Summary total B = answer key Σ bPrice (±0.01)", typeof totalB === "number" && Math.abs(totalB - keySumB) < 0.01, `got ${totalB} want ${keySumB}`);
check("Price Summary net difference = B − A", typeof netDiff === "number" && Math.abs(netDiff - (keySumB - keySumA)) < 0.01, `got ${netDiff}`);
check("Price Summary money stored as numbers, not strings", typeof totalA === "number" && typeof totalB === "number");
check("Price Summary total absolute difference present", typeof totalAbs === "number" && totalAbs >= 0, String(totalAbs));

let keyMismatchOver = 0;
let keyMismatchUnder = 0;
for (const it of key.items) {
  if (it.actual === "MISMATCH" && it.aPrice != null && it.bPrice != null) {
    if (it.bPrice > it.aPrice) keyMismatchOver += it.bPrice - it.aPrice;
    else if (it.bPrice < it.aPrice) keyMismatchUnder += it.aPrice - it.bPrice;
  }
}
const overpay = priceMap.get("Mismatch exposure — potential overpayment (Σ B − A)");
const undercharge = priceMap.get("Mismatch exposure — potential undercharge (Σ A − B)");
check("Price Summary overpayment exposure matches key (±0.01)", typeof overpay === "number" && Math.abs(overpay - keyMismatchOver) < 0.01, `got ${overpay} want ${keyMismatchOver}`);
check("Price Summary undercharge exposure matches key (±0.01)", typeof undercharge === "number" && Math.abs(undercharge - keyMismatchUnder) < 0.01, `got ${undercharge} want ${keyMismatchUnder}`);

// per-status breakdown table (columns: Status | Items | Σ A | Σ B | Σ Difference)
const statusTableStart = price.findIndex((r) => r[0] === "Status" && r[1] === "Items");
check("Price Summary per-status table present", statusTableStart !== -1);
const statusRows = new Map(
  price.slice(statusTableStart + 1).filter((r) => r.length > 0).map((r) => [r[0], r]),
);
for (const [label, count] of [
  ["Match", stats.MATCH],
  ["Mismatch", stats.MISMATCH],
  ["Multiple matches", stats.MULTIPLE],
  ["Needs review", stats.NEEDS_REVIEW],
  ["Not found", stats.NOT_FOUND],
]) {
  const row = statusRows.get(label);
  check(`status table ${label} items = ${count}`, row && row[1] === count, JSON.stringify(row));
}
const matchRow = statusRows.get("Match");
const keyMatchSumA = Math.round(key.items.filter((it) => it.actual === "MATCH").reduce((s, it) => s + (it.aPrice ?? 0), 0) * 100) / 100;
check("status table Match Σ A matches key (±0.01)", matchRow && typeof matchRow[2] === "number" && Math.abs(matchRow[2] - keyMatchSumA) < 0.01, `got ${matchRow?.[2]} want ${keyMatchSumA}`);

// ---- Summary sheet ---------------------------------------------------------
const summary = XLSX.utils.sheet_to_json(wb.Sheets["Summary"], { header: 1 });
const summaryText = summary.map((r) => r.join("=")).join("\n");
check("Summary counts Match", summaryText.includes(`Match=${stats.MATCH}`));
check("Summary counts total", summaryText.includes(`File A items=${stats.total}`));
check("Summary run timestamp (verbatim)", summaryText.includes("Run timestamp (UTC)=") && /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(summaryText));
check("Summary settings block", summaryText.includes("Auto-accept cutoff=90") && summaryText.includes("Review floor=60") && summaryText.includes("Price tolerance (%)=0") && summaryText.includes("Code stripping=auto"));
check("Summary footer line", summaryText.includes("Generated by Price Verifier — all matching ran in the browser"));

// ---- structural round-trip via exceljs (zebra CF, freeze panes, valid xlsx) --
const ExcelJSMock = await import("exceljs");
const ExcelJS = ExcelJSMock.Workbook ?? ExcelJSMock.default?.Workbook;
const wb2 = new ExcelJS();
await wb2.xlsx.load(buf);
check("exceljs re-reads workbook (4 sheets)", wb2.worksheets.length === 4);
const auditWs = wb2.getWorksheet("Full Audit");
// exceljs exposes re-read conditional formattings by index; .model may be absent.
const cfList = auditWs?.conditionalFormattings;
const cfEntries = cfList?.model ?? Array.from({ length: cfList?.length ?? 0 }, (_, i) => cfList[i]);
const expectedCfRef = `A2:${auditWs.getColumn(auditHeader.length).letter}${results.length + 1}`;
check(
  "Full Audit zebra via single conditional format",
  cfEntries.length === 1 && cfEntries[0].ref === expectedCfRef,
  JSON.stringify(cfEntries.map((c) => c.ref)),
);
check(
  "Full Audit column number formats survive round-trip",
  auditWs.getColumn(4).numFmt === "#,##0.00" &&
    auditWs.getColumn(8).numFmt === "#,##0.00" &&
    auditWs.getColumn(9).numFmt === "#,##0.00" &&
    auditWs.getColumn(10).numFmt === "0.00",
  `${auditWs.getColumn(4).numFmt}/${auditWs.getColumn(8).numFmt}/${auditWs.getColumn(9).numFmt}/${auditWs.getColumn(10).numFmt}`,
);
check("Full Audit autofilter survives round-trip", String(auditWs.autoFilter).startsWith("A1:"), String(auditWs.autoFilter));
const auditView = auditWs?.views?.[0];
check("Full Audit freeze header + first column", auditView?.state === "frozen" && auditView?.ySplit === 1 && auditView?.xSplit === 1, JSON.stringify(auditView));
const actionWs = wb2.getWorksheet("Action List");
const actionView = actionWs?.views?.[0];
check("Action List freeze header row", actionView?.state === "frozen" && actionView?.ySplit === 1, JSON.stringify(actionView));

// ---- Jev column appears only when a verdict exists --------------------------
const jevResults = [
  {
    ...results[0],
    id: 0,
    aRowNum: 2,
    aPrice: 100,
    bPrice: 110,
    difference: 10,
    status: "MATCH",
    chosen: { bRowNum: 3, rawName: "x", cleaned: "x", rawPrice: 110, price: 110, similarity: 100 },
    jevVerdict: "MATCH",
    jevConfidence: 0.92,
  },
  { ...results[0], id: 1, aRowNum: 3, status: "NOT_FOUND", bPrice: null, difference: null, chosen: null },
];
const jevStats = { total: 2, MATCH: 1, MISMATCH: 0, MULTIPLE: 0, NEEDS_REVIEW: 0, NOT_FOUND: 1, resolvedCodeStrip: { mode: "none" } };
const jevBuf = await buildReportBuffer(jevResults, jevStats, DEFAULT_SETTINGS, null);
const jevWb = XLSX.read(jevBuf, { type: "buffer" });
const jevAudit = XLSX.utils.sheet_to_json(jevWb.Sheets["Full Audit"], { header: 1 });
check("Jev Verdict column added when a row has a verdict", jevAudit[0][13] === "Jev Verdict", JSON.stringify(jevAudit[0]));
check("Jev cell formatted as verdict · confidence%", jevAudit[1]?.[13] === "MATCH · 92%", String(jevAudit[1]?.[13]));
check("Notes shifted to last column with Jev present", jevAudit[0][14] === "Notes" && jevAudit[0].length === 15);

if (failures) {
  console.error(`${failures} export checks failed`);
  process.exit(1);
}
console.log("all export checks passed");
fs.rmSync(outPath, { force: true });
