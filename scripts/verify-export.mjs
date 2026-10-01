// Export verification: node scripts/verify-export.mjs
// Rebuilds the dashboard's Excel report from a small self-contained synthetic
// MatchResult fixture and checks the resulting workbook: 5 sheets (Summary /
// Price Summary / Full Audit / Action List / Adjuster Ledger), the identity +
// valuation column set, the five costing-range buckets, Gap %, per-status
// totals, both methodology blocks, autofilter, zebra striping, freeze panes and
// number formats — plus the no-qty branch, the depreciation option and the
// Jev-column-only-when-present rule.
//
// The fixture is built by hand (no answer key, no C:/*.xlsx) so every expected
// figure below is stated independently of the engine and of the exporter.
import { buildReportBuffer, STATUS_NAMES } from "../src/lib/report-workbook.ts";
import { DEFAULT_SETTINGS } from "../src/lib/types.ts";
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";

const ExcelJSMod = await import("exceljs");
const ExcelJS = ExcelJSMod.Workbook ?? ExcelJSMod.default?.Workbook;

const DOT = "·"; // jev verdict separator
const EM = "—"; // em dash
const ARROW = "→"; // right arrow

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name} ${detail}`);
  }
};
const near = (a, b, eps = 1e-9) => typeof a === "number" && Math.abs(a - b) < eps;

// ===========================================================================
// Fixture: an 11-row claim sheet against a 14-row costing sheet.
// ===========================================================================

// File B (costing), keyed by the spreadsheet row number it came from.
const B_ROWS = {
  2: { name: "Air Filter Adventure Diesel", price: 350, qty: 2, code: "A-1022" },
  3: { name: "Air Filter A1022 bulk", price: 320, qty: 8, code: "A1022" },
  4: { name: "Air Filter A1022 promo", price: 0, qty: 1, code: "A1022" },
  5: { name: "HEX BOLT M8X40", price: 12.5, qty: 100, code: "AB-1001" },
  6: { name: "2 Inch Gate Valve", price: 100, qty: 2, code: "AB-1002" },
  7: { name: "Gate Valve 2in Brass", price: 120, qty: 3, code: "AB-1003" },
  8: { name: "OIL SEAL 27X40X6", price: 88, qty: 4, code: null },
  9: { name: "Oil Seal 27x40x6", price: 92, qty: 6, code: null },
  10: { name: "Leather Work Gloves", price: 210, qty: 5, code: null },
  11: { name: "Ball Joint Lower KBJ-1202", price: 260, qty: 2, code: "KBJ-1202" },
  12: { name: "carbon brush", price: 0, qty: 10, code: null },
  13: { name: "Solvent Cleaner 5L", price: 2500, qty: 4, code: null },
  14: { name: "Common Wire Nail 2 inch", price: 15, qty: 500, code: "AB-0004" },
  15: { name: "Steel Pipe 1/2 inch", price: 45, qty: 20, code: "AB-0005" },
};

const cand = (bRow, similarity, matchedCode = null) => {
  const b = B_ROWS[bRow];
  return {
    bRowNum: bRow,
    rawName: b.name,
    cleaned: b.name.toLowerCase(),
    rawPrice: b.price,
    price: b.price,
    similarity,
    matchedCode,
  };
};

// The exact Candidate objects the fixture rows refer to, so `chosen` is the
// same object as the head of `candidates` (as the engine leaves it).
const C = {
  airA: cand(2, 92, "A1022"),
  airB: cand(3, 90, "A1022"),
  airC: cand(4, 88, "A1022"),
  bolt: cand(5, 100),
  gateLow: cand(6, 78),
  gateHigh: cand(7, 84),
  sealLow: cand(8, 100),
  sealHigh: cand(9, 100),
  glove: cand(10, 100),
  joint: cand(11, 60, "KBJ1202"),
  brush: cand(12, 65),
  solvent: cand(13, 72),
};

/** Assemble one MatchResult in the shape the app holds. */
const claim = (spec) => {
  const chosen = spec.chosen ?? null;
  const bPrice = chosen ? chosen.price : null;
  return {
    id: spec.id,
    aRowNum: spec.aRowNum,
    aRawName: spec.aRawName,
    aCleaned: spec.aCleaned,
    aRawPrice: spec.aPrice,
    aPrice: spec.aPrice === undefined ? null : spec.aPrice,
    aCodes: spec.aCodes ?? [],
    status: spec.status,
    method: spec.method ?? null,
    score: spec.score ?? null,
    candidates: spec.candidates ?? [],
    chosen,
    bPrice,
    difference:
      bPrice !== null && spec.aPrice
        ? Math.round((bPrice - spec.aPrice) * 100) / 100
        : null,
    jevVerdict: null,
    jevConfidence: null,
    notes: spec.notes ?? [],
  };
};

const results = [
  claim({
    id: 0, aRowNum: 2, aRawName: "AIR FILTER, A-1022 SAKURA", aCleaned: "air filter sakura",
    aCodes: ["A1022"], aPrice: 540, status: "CONFIRMED", method: "code", score: 92,
    candidates: [C.airA, C.airB, C.airC], chosen: C.airA,
    notes: ["Identity by part number: A1022."],
  }),
  claim({
    id: 1, aRowNum: 3, aRawName: "HEX BOLT M8 X 40", aCleaned: "hex bolt m8x40",
    aPrice: 50, status: "STRONG", method: "exact", score: 100,
    candidates: [C.bolt], chosen: C.bolt,
  }),
  claim({
    id: 2, aRowNum: 4, aRawName: "GATE VALVE 2 INCH", aCleaned: "gate valve 2 inch",
    aPrice: 200, status: "PROBABLE", method: "fuzzy", score: 84,
    candidates: [C.gateHigh, C.gateLow], chosen: C.gateHigh,
    notes: [
      "Best name similarity 84 - fuzzy evidence only, confirm manually.",
      "Second note: reviewed against 2 costing rows.",
    ],
  }),
  claim({
    id: 3, aRowNum: 5, aRawName: "OIL SEAL 27X40X6", aCleaned: "oil seal 27x40x6",
    aPrice: 95, status: "STRONG", method: "exact", score: 100,
    candidates: [C.sealLow, C.sealHigh], chosen: C.sealLow,
  }),
  claim({
    id: 4, aRowNum: 6, aRawName: "SAFETY GLOVE LEATHER", aCleaned: "safety glove leather",
    aPrice: 199, status: "STRONG", method: "exact", score: 100,
    candidates: [C.glove], chosen: C.glove,
  }),
  claim({
    id: 5, aRowNum: 7, aRawName: "BALL JOINT KBJ-1202", aCleaned: "ball joint kbj 1202",
    aCodes: ["KBJ1202"], aPrice: 300, status: "CONFLICT",
    candidates: [C.joint],
    notes: ["1 costing row shares this part number but describes a different product - query the insured."],
  }),
  claim({
    id: 6, aRowNum: 8, aRawName: "PNEUMATIC CYLINDER 60MM", aCleaned: "pneumatic cylinder 60mm",
    aPrice: null, status: "UNMATCHED", notes: ["File A row has no item name."],
  }),
  claim({
    id: 7, aRowNum: 9, aRawName: "CARBON BRUSH", aCleaned: "carbon brush",
    aPrice: 75, status: "PROBABLE", method: "fuzzy", score: 65,
    candidates: [C.brush], chosen: C.brush,
  }),
  claim({
    id: 8, aRowNum: 10, aRawName: "SOLVENT CLEANER 5L", aCleaned: "solvent cleaner 5l",
    aPrice: 2500, status: "PROBABLE", method: "fuzzy", score: 72,
    candidates: [C.solvent], chosen: C.solvent,
  }),
  claim({
    id: 9, aRowNum: 11, aRawName: "GLOVE NITRILE BLUE", aCleaned: "glove nitrile blue",
    aPrice: 120, status: "UNMATCHED",
  }),
  claim({
    id: 10, aRowNum: 12, aRawName: "GLOVE COTTON GREY", aCleaned: "glove cotton grey",
    aPrice: 0, status: "UNMATCHED",
  }),
];

const byARow = new Map(results.map((r) => [r.aRowNum, r]));

const stats = {
  total: results.length,
  CONFIRMED: results.filter((r) => r.status === "CONFIRMED").length,
  STRONG: results.filter((r) => r.status === "STRONG").length,
  PROBABLE: results.filter((r) => r.status === "PROBABLE").length,
  CONFLICT: results.filter((r) => r.status === "CONFLICT").length,
  UNMATCHED: results.filter((r) => r.status === "UNMATCHED").length,
  resolvedCodeStrip: { mode: "firstToken" },
};
// Action List = everything that is neither CONFIRMED nor STRONG.
const PROBLEMS = stats.PROBABLE + stats.CONFLICT + stats.UNMATCHED;

const QTY = {
  aQty: { 2: 5, 3: 100, 4: 1, 5: 10, 6: 2, 7: 4, 8: 1, 9: 20, 10: 1, 11: 50, 12: 30 },
  bQty: { 2: 2, 3: 8, 4: 1, 5: 100, 6: 2, 7: 3, 8: 4, 9: 6, 10: 5, 11: 2, 12: 10, 13: 4, 14: 500, 15: 20 },
  aDups: { 2: [13, 14] },
  bRows: B_ROWS,
};
const FILE_NAMES = { a: "masterlist.xlsx", b: "price_file_to_verify.xlsx" };

// ---- Hand-computed expectations -------------------------------------------
const EXPECT_SUM_A = 540 + 50 + 200 + 95 + 199 + 300 + 75 + 2500 + 120; // 4079 (A8 null, A12 zero)
const EXPECT_SUM_B = 350 + 12.5 + 120 + 88 + 210 + 0 + 2500; // 3280.50
const EXPECT_ABS_DIFF = 190 + 37.5 + 80 + 7 + 11 + 75; // 400.50
const EXPECT_GAPS = [190 / 540, 37.5 / 50, 80 / 200, 7 / 95, 11 / 199, 75 / 75, 0].map((g) => g * 100);
const EXPECT_AVG_GAP = EXPECT_GAPS.reduce((a, b) => a + b, 0) / EXPECT_GAPS.length; // ~37.5830
const EXPECT_MAX_GAP = 100;
const EXPECT_EXPOSURE = 540 - 350 + (50 - 12.5) + (200 - 120) + (95 - 92) + (300 - 260); // 350.50
const EXPECT_STATUS_MONEY = {
  "Confirmed match": { items: 1, sumA: 540, sumB: 350, sumDiff: -190 },
  "Strong match": { items: 3, sumA: 344, sumB: 310.5, sumDiff: -33.5 },
  "Probable match": { items: 3, sumA: 2775, sumB: 2620, sumDiff: -155 },
  Conflict: { items: 1, sumA: 300, sumB: null, sumDiff: null },
  Unmatched: { items: 3, sumA: 120, sumB: null, sumDiff: null },
};
const EXPECT_SUMMARY_COUNTS = {
  "Confirmed matches": stats.CONFIRMED,
  "Strong matches": stats.STRONG,
  "Probable matches": stats.PROBABLE,
  Conflicts: stats.CONFLICT,
  Unmatched: stats.UNMATCHED,
};
// Costing rows referenced by an ESTABLISHED identity (Confirmed/Strong only).
const EXPECT_LEDGER_PAIR = { 2: 2, 3: 2, 4: 2, 5: 3, 8: 5, 9: 5, 10: 6 };

const EXPECT_QTY_HEADER = [
  "A Row", "A Item Name", "A Cleaned Name", "A Part Codes", "A Price",
  "B Row", "B Matched Name", "B Cleaned Name",
  "Claimed Qty", "Assessed Qty",
  "B Price",
  "Records", "Lowest", "Highest", "Wtd Avg",
  "Difference", "Gap %", "Score", "Method", "Status",
  "Duplicate Rows",
  "Notes",
];
const EXPECT_PLAIN_HEADER = [
  "A Row", "A Item Name", "A Cleaned Name", "A Part Codes", "A Price",
  "B Row", "B Matched Name", "B Cleaned Name", "B Price",
  "Records", "Lowest", "Highest", "Wtd Avg",
  "Difference", "Gap %", "Score", "Method", "Status",
  "Notes",
];
const EXPECT_JEV_HEADER = [...EXPECT_PLAIN_HEADER.slice(0, -1), "Jev Verdict", "Notes"];
const LEDGER_HEADERS = [
  "B Row", "Description", "Part Code", "Claimed Qty", "Assessed Qty",
  "Unit Price", "Total Cost", "Status", "Supports Claim Rows", "Matched A Items",
];
// One distinctive fragment per QUALIFICATION_NOTES entry. That const is
// module-private, so the substrings are read off report-workbook.ts instead of
// being imported.
const NOTE_FRAGMENTS = [
  "identity (same item?)",
  "qty-weighted average",
  "specific identification",
  "zero-price costing lines",
];

// ===========================================================================
// Read helpers
// ===========================================================================
const sheetRows = (wb, name) =>
  XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, blankrows: true });
const colIdx = (header, name) => header.indexOf(name); // 0-based, -1 when absent
const at = (header, row, name) => row[colIdx(header, name)];
const colLetter = (n) => {
  let s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
  return s;
};
const rowWith = (rows, needle) =>
  rows.find((r) => r && typeof r[0] === "string" && r[0].includes(needle));
const metric = (rows, needle) => {
  const r = rowWith(rows, needle);
  return r ? r[1] : undefined;
};
const blob = (rows) => rows.flat().filter((v) => typeof v === "string").join("\n").toLowerCase();
const line = (rows, aRowNum) => rows.find((r) => r && r[0] === aRowNum);
const blank = (v) => v === null || v === undefined || v === "";

// ===========================================================================
// Main workbook: quantities + duplicate map + full B row map
// ===========================================================================
const buf = await buildReportBuffer(results, stats, DEFAULT_SETTINGS, FILE_NAMES, QTY);
const outPath = path.join(import.meta.dirname, "verify-export.xlsx");
fs.writeFileSync(outPath, buf);
const wb = XLSX.read(fs.readFileSync(outPath), { type: "buffer", cellNF: true, blankrows: true });

// ---- sheet structure -------------------------------------------------------
const SHEET_NAMES = ["Summary", "Price Summary", "Full Audit", "Action List", "Adjuster Ledger"];
check("5 sheets", wb.SheetNames.length === 5, wb.SheetNames.join(","));
check("sheet names & order", JSON.stringify(wb.SheetNames) === JSON.stringify(SHEET_NAMES), wb.SheetNames.join(","));

// ---- Full Audit / Action List shape ---------------------------------------
const audit = sheetRows(wb, "Full Audit");
const auditHeader = audit[0];
const action = sheetRows(wb, "Action List");
const actionHeader = action[0];

check("Full Audit rows = 1 + every claim row", audit.length === 1 + results.length, String(audit.length));
check("Action List rows = 1 + everything not CONFIRMED/STRONG", action.length === 1 + PROBLEMS, `${action.length} (want ${1 + PROBLEMS})`);
check("Full Audit columns: base + Claimed/Assessed Qty + Duplicate Rows, no Jev", JSON.stringify(auditHeader) === JSON.stringify(EXPECT_QTY_HEADER), JSON.stringify(auditHeader));
check("Action List shares the Full Audit layout", JSON.stringify(actionHeader) === JSON.stringify(EXPECT_QTY_HEADER), JSON.stringify(actionHeader));
check("no Jev column when no row has a verdict", colIdx(auditHeader, "Jev Verdict") === -1);
check("Notes is the last column", auditHeader[auditHeader.length - 1] === "Notes");

const r2 = line(audit, 2); // AIR FILTER, CONFIRMED
const r3 = line(audit, 3); // HEX BOLT, STRONG
const r4 = line(audit, 4); // GATE VALVE, PROBABLE
const r5 = line(audit, 5); // OIL SEAL, STRONG
const r6 = line(audit, 6); // SAFETY GLOVE, STRONG
const r7 = line(audit, 7); // BALL JOINT, CONFLICT
const r8 = line(audit, 8); // PNEUMATIC CYLINDER, UNMATCHED
const r9 = line(audit, 9); // CARBON BRUSH, PROBABLE, zero-price costing record
const r10 = line(audit, 10); // SOLVENT CLEANER, PROBABLE, in range
const r11 = line(audit, 11); // GLOVE NITRILE, UNMATCHED
const r12 = line(audit, 12); // GLOVE COTTON, UNMATCHED, claimed price 0

check("A Part Codes joined from aCodes", at(auditHeader, r2, "A Part Codes") === "A1022", String(at(auditHeader, r2, "A Part Codes")));
check("A Part Codes blank when the row carries none", blank(at(auditHeader, r3, "A Part Codes")));
check("Claimed Qty / Assessed Qty read the qty maps", at(auditHeader, r2, "Claimed Qty") === 5 && at(auditHeader, r2, "Assessed Qty") === 2, `${at(auditHeader, r2, "Claimed Qty")}/${at(auditHeader, r2, "Assessed Qty")}`);
check("Assessed Qty blank when no reference record is chosen", blank(at(auditHeader, r7, "Assessed Qty")), String(at(auditHeader, r7, "Assessed Qty")));
check("Duplicate Rows joined list", at(auditHeader, r2, "Duplicate Rows") === "13, 14", String(at(auditHeader, r2, "Duplicate Rows")));
check("Duplicate Rows blank for a unique claim row", blank(at(auditHeader, r3, "Duplicate Rows")), JSON.stringify(at(auditHeader, r3, "Duplicate Rows")));
check("Status cells use the STATUS_NAMES labels", [2, 3, 4, 5, 6, 7, 8, 9].every((n) => line(audit, n)[colIdx(auditHeader, "Status")] === STATUS_NAMES[byARow.get(n).status]));
check("Notes joined with a pipe", at(auditHeader, r4, "Notes") === `${byARow.get(4).notes.join(" | ")}` && at(auditHeader, r2, "Notes") === "Identity by part number: A1022.", String(at(auditHeader, r4, "Notes")));
check("B Row / B Matched Name mirror the chosen reference", at(auditHeader, r2, "B Row") === 2 && at(auditHeader, r2, "B Matched Name") === "Air Filter Adventure Diesel" && at(auditHeader, r2, "B Price") === 350, JSON.stringify([at(auditHeader, r2, "B Row"), at(auditHeader, r2, "B Price")]));
check("B-side columns blank when nothing is chosen", [r7, r8].every((r) => ["B Row", "B Matched Name", "B Cleaned Name", "B Price", "Difference"].every((c) => blank(at(auditHeader, r, c)))), JSON.stringify(["B Row", "B Price", "Difference"].map((c) => at(auditHeader, r7, c))));
// Regression guard: buildLayout() once placed the qty pair after "B Price"
// while auditRow() wrote its eight leading cells without it, so B Price /
// Claimed Qty / Assessed Qty each showed the neighbouring column's value. The
// three values here (5 / 2 / 350) are distinct, so any re-drift is caught.
check("qty columns render under their own headings (regression guard)", at(auditHeader, r2, "Claimed Qty") === 5 && at(auditHeader, r2, "Assessed Qty") === 2 && at(auditHeader, r2, "B Price") === 350 && auditHeader.indexOf("Claimed Qty") === 8 && auditHeader.indexOf("Assessed Qty") === 9 && auditHeader.indexOf("B Price") === 10, JSON.stringify(r2.slice(8, 11)));
check("B Price holds the chosen price, not a quantity, on every priced row", [2, 3, 4, 5, 6, 9, 10].every((n) => at(auditHeader, line(audit, n), "B Price") === byARow.get(n).chosen.price), JSON.stringify([2, 3, 4, 5, 6, 9, 10].map((n) => at(auditHeader, line(audit, n), "B Price"))));

// ---- valuation columns -----------------------------------------------------
check("Records counts priced candidates only (zero-price row excluded)", at(auditHeader, r2, "Records") === 2, String(at(auditHeader, r2, "Records")));
check("Lowest / Highest exclude the zero-price costing row", at(auditHeader, r2, "Lowest") === 320 && at(auditHeader, r2, "Highest") === 350, `${at(auditHeader, r2, "Lowest")}/${at(auditHeader, r2, "Highest")}`);
check("Wtd Avg is quantity-weighted across the priced records", at(auditHeader, r2, "Wtd Avg") === 326, String(at(auditHeader, r2, "Wtd Avg")));
check("second item: 2 records, 88-92 range, 90.4 weighted avg", at(auditHeader, r5, "Records") === 2 && at(auditHeader, r5, "Lowest") === 88 && at(auditHeader, r5, "Highest") === 92 && at(auditHeader, r5, "Wtd Avg") === 90.4, JSON.stringify(["Records", "Lowest", "Highest", "Wtd Avg"].map((c) => at(auditHeader, r5, c))));
check("zero-priced costing rows: Records 0, range stats blank", at(auditHeader, r9, "Records") === 0 && ["Lowest", "Highest", "Wtd Avg"].every((c) => blank(at(auditHeader, r9, c))), JSON.stringify(["Records", "Lowest", "Highest", "Wtd Avg"].map((c) => at(auditHeader, r9, c))));
check("single-record item: claimed 199 vs the 210 costing record, Difference +11", at(auditHeader, r6, "Records") === 1 && at(auditHeader, r6, "Lowest") === 210 && at(auditHeader, r6, "Highest") === 210 && at(auditHeader, r6, "Wtd Avg") === 210 && at(auditHeader, r6, "Difference") === 11, JSON.stringify(["Records", "Lowest", "Highest", "Wtd Avg", "Difference"].map((c) => at(auditHeader, r6, c))));
check("valuation blank for an unmatched row (no candidates)", ["Records", "Lowest", "Highest", "Wtd Avg"].every((c) => blank(at(auditHeader, r8, c))), JSON.stringify(["Records", "Lowest", "Highest", "Wtd Avg"].map((c) => at(auditHeader, r8, c))));

// ---- Gap % -----------------------------------------------------------------
check("Gap % = |difference| / aPrice * 100", near(at(auditHeader, r2, "Gap %"), (190 / 540) * 100), `${at(auditHeader, r2, "Gap %")} want ${(190 / 540) * 100}`);
check("Gap % is relative to the chosen reference, not the range high", near(at(auditHeader, r5, "Gap %"), (7 / 95) * 100) && !near(at(auditHeader, r5, "Gap %"), (3 / 95) * 100), String(at(auditHeader, r5, "Gap %")));
check("Gap % is 0 when the reference price equals the claim", at(auditHeader, r10, "Gap %") === 0, String(at(auditHeader, r10, "Gap %")));
check("Gap % blank when there is no difference (unmatched rows)", blank(at(auditHeader, r8, "Gap %")) && blank(at(auditHeader, r11, "Gap %")), `${JSON.stringify(at(auditHeader, r8, "Gap %"))}/${JSON.stringify(at(auditHeader, r11, "Gap %"))}`);
check("Gap % blank when the claimed price is zero", blank(at(auditHeader, r12, "Gap %")), String(at(auditHeader, r12, "Gap %")));
check("Gap % has the same index in the Action List", actionHeader.indexOf("Gap %") === auditHeader.indexOf("Gap %") && actionHeader.indexOf("Gap %") === EXPECT_QTY_HEADER.indexOf("Gap %"));

// ---- autofilter ------------------------------------------------------------
const afBad = SHEET_NAMES.slice(2).filter((n) => !String(wb.Sheets[n]["!autofilter"]?.ref ?? "").startsWith("A1:"));
check("autofilter over the header row on all three table sheets", afBad.length === 0, afBad.join(","));

// ---- Price Summary ---------------------------------------------------------
const price = sheetRows(wb, "Price Summary");
check("Price Summary totals: S A, S B, total absolute difference", near(metric(price, "Total A value"), EXPECT_SUM_A) && near(metric(price, "Total B value"), EXPECT_SUM_B) && near(metric(price, "Total absolute difference"), EXPECT_ABS_DIFF), `${metric(price, "Total A value")}/${metric(price, "Total B value")}/${metric(price, "Total absolute difference")}`);
check("Net difference = S B - S A", near(metric(price, "Net difference"), EXPECT_SUM_B - EXPECT_SUM_A), String(metric(price, "Net difference")));
check("Average gap % and largest gap %", near(metric(price, "Average gap %"), EXPECT_AVG_GAP, 1e-6) && near(metric(price, "Largest gap %"), EXPECT_MAX_GAP), `${metric(price, "Average gap %")} want ${EXPECT_AVG_GAP} / ${metric(price, "Largest gap %")}`);
check("totals stored as numbers, not strings", typeof metric(price, "Total A value") === "number" && typeof metric(price, "Overpayment exposure") === "number");
check("Claimed price inside costing range", metric(price, "Claimed price inside costing range") === 1, String(metric(price, "Claimed price inside costing range")));
check("Claimed ABOVE range - potential overpayment", metric(price, "Claimed ABOVE range") === 5, String(metric(price, "Claimed ABOVE range")));
check("...of which explained by depreciation allowance (0% allowance)", metric(price, "of which explained by depreciation allowance") === 0, String(metric(price, "of which explained by depreciation allowance")));
check("Overpayment exposure = S(claimed - highest) over above-range rows", near(metric(price, "Overpayment exposure"), EXPECT_EXPOSURE), `${metric(price, "Overpayment exposure")} want ${EXPECT_EXPOSURE}`);
check("overpayment exposure label spells out its formula", ["Overpayment exposure", "claimed", "highest", "above-range only"].every((f) => String(rowWith(price, "Overpayment exposure")[0]).includes(f)), String(rowWith(price, "Overpayment exposure")[0]));
check("Claimed BELOW range", metric(price, "Claimed BELOW range") === 1, String(metric(price, "Claimed BELOW range")));
check("Rows without usable costing prices", metric(price, "Rows without usable costing prices") === 4, String(metric(price, "Rows without usable costing prices")));
check("range buckets partition the claim rows", [1, 5, 0, 1, 4].reduce((a, b) => a + b, 0) === results.length && metric(price, "Claimed price inside costing range") + metric(price, "Claimed ABOVE range") + metric(price, "of which explained by depreciation allowance") + metric(price, "Claimed BELOW range") + metric(price, "Rows without usable costing prices") === results.length);
check("old mismatch-exposure / auto-accept rows are gone", !rowWith(price, "Mismatch exposure") && !rowWith(price, "undercharge") && !rowWith(price, "Auto-accept cutoff"), JSON.stringify(price.map((r) => r?.[0]).filter((s) => typeof s === "string" && /exposure|undercharge|cutoff/i.test(s))));

const statusHeaderIdx = price.findIndex((r) => r && r[0] === "Status" && r[1] === "Items");
const statusRows = new Map(
  price.slice(statusHeaderIdx + 1)
    .filter((r) => r && typeof r[0] === "string" && r[0].length > 0 && r[0] !== "How to read this report")
    .map((r) => [r[0], r]),
);
check("Price Summary per-status table present", statusHeaderIdx !== -1);
const statusBad = Object.entries(EXPECT_STATUS_MONEY).filter(([label, e]) => {
  const r = statusRows.get(label);
  return !r || r[1] !== e.items || !near(r[2], e.sumA) ||
    (e.sumB === null ? !blank(r[3]) : !near(r[3], e.sumB)) ||
    (e.sumDiff === null ? !blank(r[4]) : !near(r[4], e.sumDiff));
});
check("per-status Items / S A / S B / S Difference", statusBad.length === 0, JSON.stringify(statusBad.map(([l]) => [l, statusRows.get(l)])));
check("per-status item counts sum to the claim total", [...statusRows.values()].reduce((s, r) => s + r[1], 0) === results.length, String([...statusRows.values()].reduce((s, r) => s + r[1], 0)));
check("per-status S A sums to the grand total", near([...statusRows.values()].reduce((s, r) => s + (typeof r[2] === "number" ? r[2] : 0), 0), EXPECT_SUM_A));
check("Price Summary methodology block header", !!rowWith(price, "How to read this report"));
check("all four qualification notes on Price Summary", NOTE_FRAGMENTS.every((f) => blob(price).includes(f)), NOTE_FRAGMENTS.filter((f) => !blob(price).includes(f)).join("|"));

// ---- Summary sheet ---------------------------------------------------------
const summary = sheetRows(wb, "Summary");
const sumMap = new Map(summary.filter((r) => r && r.length > 0 && typeof r[0] === "string").map((r) => [r[0], r[1]]));
const sumCountBad = Object.entries(EXPECT_SUMMARY_COUNTS).filter(([k, v]) => sumMap.get(k) !== v);
check("Summary mirrors the claim total and the five status counts", sumMap.get("File A items") === results.length && sumCountBad.length === 0, JSON.stringify(sumCountBad));
check("Summary review floor / gap tolerance / code stripping", sumMap.get("Review floor (fuzzy kept as Probable)") === 60 && sumMap.get("Reference gap tolerance (%)") === 0 && String(sumMap.get("Code stripping (name comparison only)")).includes("auto") && String(sumMap.get("Code stripping (name comparison only)")).includes("firstToken"), JSON.stringify([sumMap.get("Review floor (fuzzy kept as Probable)"), sumMap.get("Reference gap tolerance (%)"), sumMap.get("Code stripping (name comparison only)")]));
check("old Auto-accept cutoff row is gone", !sumMap.has("Auto-accept cutoff"), JSON.stringify([...sumMap.keys()]));
check("Summary records the run timestamp and both file names", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(String(sumMap.get("Run timestamp (UTC)"))) && sumMap.get("File A (inventory/claim)") === FILE_NAMES.a && sumMap.get("File B (costing/prices)") === FILE_NAMES.b, String(sumMap.get("Run timestamp (UTC)")));
check("Summary methodology block header", !!rowWith(summary, "Identification & valuation model"));
check("all four qualification notes on Summary", NOTE_FRAGMENTS.every((f) => blob(summary).includes(f)), NOTE_FRAGMENTS.filter((f) => !blob(summary).includes(f)).join("|"));
check("Summary footer line", blob(summary).includes(`generated by price verifier ${EM} all matching ran in the browser`));

// ---- Adjuster Ledger -------------------------------------------------------
const ledger = sheetRows(wb, "Adjuster Ledger");
const ledgerHeader = ledger[0];
const led = (bRow) => ledger.find((r) => r && r[0] === bRow);
check("Adjuster Ledger header", JSON.stringify(ledgerHeader) === JSON.stringify(LEDGER_HEADERS), JSON.stringify(ledgerHeader));
check("Adjuster Ledger lists every File B row", ledger.length === 1 + Object.keys(B_ROWS).length, String(ledger.length));
const ledgerBad = Object.keys(B_ROWS).map(Number).filter((bRow) => {
  const r = led(bRow);
  const want = EXPECT_LEDGER_PAIR[bRow];
  const wantStatus = want ? `Paired ${ARROW} A${want}` : "Unmatched";
  return !r || at(ledgerHeader, r, "Status") !== wantStatus ||
    (want ? at(ledgerHeader, r, "Supports Claim Rows") !== String(want) : !blank(at(ledgerHeader, r, "Supports Claim Rows")));
});
check("ledger pairs only established identities, others Unmatched", ledgerBad.length === 0, `bad bRows: ${ledgerBad.join(",")}`);
check("ledger names the claim item behind a paired costing row", String(at(ledgerHeader, led(2), "Matched A Items")) === "AIR FILTER, A-1022 SAKURA" && at(ledgerHeader, led(2), "Description") === B_ROWS[2].name && at(ledgerHeader, led(2), "Part Code") === "A-1022");
check("ledger leaves Probable/Conflict candidates and orphans Unmatched", at(ledgerHeader, led(7), "Status") === "Unmatched" && at(ledgerHeader, led(11), "Status") === "Unmatched" && at(ledgerHeader, led(14), "Status") === "Unmatched", `${at(ledgerHeader, led(7), "Status")}/${at(ledgerHeader, led(11), "Status")}/${at(ledgerHeader, led(14), "Status")}`);
check("ledger Total Cost = Assessed Qty x Unit Price", at(ledgerHeader, led(2), "Total Cost") === 700 && at(ledgerHeader, led(15), "Total Cost") === 900, `${at(ledgerHeader, led(2), "Total Cost")}/${at(ledgerHeader, led(15), "Total Cost")}`);
check("ledger Claimed Qty comes from the paired claim row", at(ledgerHeader, led(2), "Claimed Qty") === 5 && blank(at(ledgerHeader, led(7), "Claimed Qty")), `${at(ledgerHeader, led(2), "Claimed Qty")}/${JSON.stringify(at(ledgerHeader, led(7), "Claimed Qty"))}`);

// ---- structural round-trip via exceljs -------------------------------------
const wb2 = new ExcelJS();
await wb2.xlsx.load(buf);
check("exceljs re-reads the workbook (5 sheets)", wb2.worksheets.length === 5, String(wb2.worksheets.length));
check("workbook creator recorded", wb2.creator === "Price Verifier", String(wb2.creator));

const auditWs = wb2.getWorksheet("Full Audit");
const actionWs = wb2.getWorksheet("Action List");
const ledgerWs = wb2.getWorksheet("Adjuster Ledger");
const cfList = auditWs.conditionalFormattings;
const cfEntries = cfList?.model ?? Array.from({ length: cfList?.length ?? 0 }, (_, i) => cfList[i]);
const expectedCfRef = `A2:${colLetter(auditHeader.length)}${results.length + 1}`;
const cfFormulae = cfEntries[0]?.rules?.map((r) => r.formulae) ?? cfEntries[0]?.formulae;
check("Full Audit zebra via a single conditional format", cfEntries.length === 1 && cfEntries[0].ref === expectedCfRef && JSON.stringify(cfFormulae) === JSON.stringify([["MOD(ROW(),2)=0"]]), `${JSON.stringify(cfEntries.map((c) => c.ref))} want ${expectedCfRef}`);
check("Action List is not zebra-striped", (actionWs.conditionalFormattings?.length ?? 0) === 0, String(actionWs.conditionalFormattings?.length));

const FMT = {
  "A Price": "#,##0.00", "B Price": "#,##0.00", "Lowest": "#,##0.00", "Highest": "#,##0.00",
  "Wtd Avg": "#,##0.00", Records: "#,##0", Difference: "#,##0.00", "Gap %": "0.00",
  "Claimed Qty": "#,##0.##", "Assessed Qty": "#,##0.##",
};
const fmtBad = Object.entries(FMT).filter(([name, f]) => auditWs.getColumn(colIdx(auditHeader, name) + 1).numFmt !== f);
check("Full Audit column number formats survive round-trip", fmtBad.length === 0, JSON.stringify(fmtBad.map(([n]) => [n, auditWs.getColumn(colIdx(auditHeader, n) + 1).numFmt])));
check("Adjuster Ledger number formats", ["Unit Price", "Total Cost"].every((c) => ledgerWs.getColumn(colIdx(ledgerHeader, c) + 1).numFmt === "#,##0.00") && ["Claimed Qty", "Assessed Qty"].every((c) => ledgerWs.getColumn(colIdx(ledgerHeader, c) + 1).numFmt === "#,##0.##"), ["Unit Price", "Total Cost", "Claimed Qty", "Assessed Qty"].map((c) => `${c}=${ledgerWs.getColumn(colIdx(ledgerHeader, c) + 1).numFmt}`).join(" "));

const auditCells = wb.Sheets["Full Audit"];
const cellMoney = (name) => auditCells[`${colLetter(colIdx(auditHeader, name) + 1)}2`];
check("data cells carry the column formats", cellMoney("A Price")?.z === "#,##0.00" && cellMoney("Gap %")?.z === "0.00" && cellMoney("Wtd Avg")?.z === "#,##0.00", `${cellMoney("A Price")?.z}/${cellMoney("Gap %")?.z}/${cellMoney("Wtd Avg")?.z}`);
// The qty pair used to push the MONEY_FMT one column right of its data, so
// pin that the B Price cell itself is money-formatted when a qty map is on.
check("B Price cell is money-formatted with a qty map present", cellMoney("B Price")?.v === 350 && cellMoney("B Price")?.z === "#,##0.00" && auditWs.getColumn(colIdx(auditHeader, "B Price") + 1).numFmt === "#,##0.00", `${JSON.stringify(cellMoney("B Price"))} col=${colLetter(colIdx(auditHeader, "B Price") + 1)}`);
check("autofilter survives round-trip on all table sheets", [auditWs, actionWs, ledgerWs].every((ws) => String(ws.autoFilter).startsWith("A1:")), [auditWs, actionWs, ledgerWs].map((ws) => String(ws.autoFilter)).join(" | "));
const av = auditWs.views?.[0];
const cv = actionWs.views?.[0];
const lv = ledgerWs.views?.[0];
check("Full Audit freezes the header row and the first column", av?.state === "frozen" && av?.ySplit === 1 && av?.xSplit === 1, JSON.stringify(av));
check("Action List and Adjuster Ledger freeze the header row only", cv?.state === "frozen" && cv?.ySplit === 1 && !cv?.xSplit && lv?.state === "frozen" && lv?.ySplit === 1, `${JSON.stringify(cv)} ${JSON.stringify(lv)}`);

// ===========================================================================
// Branch: no qty maps -> no qty columns and no Adjuster Ledger
// ===========================================================================
const plainBuf = await buildReportBuffer(results, stats, DEFAULT_SETTINGS, FILE_NAMES);
const plainWb = XLSX.read(plainBuf, { type: "buffer" });
const plainAudit = sheetRows(plainWb, "Full Audit");
const plainHeader = plainAudit[0];
check("no qty maps -> 4 sheets, Adjuster Ledger absent", plainWb.SheetNames.length === 4 && !plainWb.SheetNames.includes("Adjuster Ledger"), plainWb.SheetNames.join(","));
check("no qty maps -> 19-column header (no Claimed/Assessed Qty, no Duplicate Rows)", JSON.stringify(plainHeader) === JSON.stringify(EXPECT_PLAIN_HEADER), JSON.stringify(plainHeader));
check("no qty maps -> valuation columns still computed, weighted avg degrades to the mean", ["Records", "Lowest", "Highest", "Wtd Avg"].every((c) => plainHeader.includes(c)) && plainAudit[1][colIdx(plainHeader, "Records")] === 2 && plainAudit[1][colIdx(plainHeader, "Lowest")] === 320 && plainAudit[1][colIdx(plainHeader, "Highest")] === 350 && plainAudit[1][colIdx(plainHeader, "Wtd Avg")] === 335, JSON.stringify(["Records", "Lowest", "Highest", "Wtd Avg"].map((c) => plainAudit[1][colIdx(plainHeader, c)])));
check("no qty maps -> Action List still holds every problem", sheetRows(plainWb, "Action List").length === 1 + PROBLEMS);

// ===========================================================================
// Branch: depreciation allowance (6th argument, options)
// ===========================================================================
const depWb = XLSX.read(
  await buildReportBuffer(results, stats, DEFAULT_SETTINGS, FILE_NAMES, undefined, { depreciationPct: 45 }),
  { type: "buffer" },
);
const depPrice = sheetRows(depWb, "Price Summary");
check("45% allowance moves rows from above to above-allowed", metric(depPrice, "Claimed ABOVE range") === 1 && metric(depPrice, "of which explained by depreciation allowance") === 4, `${metric(depPrice, "Claimed ABOVE range")} above / ${metric(depPrice, "of which explained by depreciation allowance")} allowed`);
check("45% allowance shrinks the overpayment exposure to 37.50", near(metric(depPrice, "Overpayment exposure"), 37.5) && metric(depPrice, "Overpayment exposure") < EXPECT_EXPOSURE, `${metric(depPrice, "Overpayment exposure")} want 37.50 (was ${EXPECT_EXPOSURE})`);
check("allowance leaves in-range / below / unpriced counts untouched", metric(depPrice, "Claimed price inside costing range") === 1 && metric(depPrice, "Claimed BELOW range") === 1 && metric(depPrice, "Rows without usable costing prices") === 4, JSON.stringify([1, 1, 4]));
check("allowance changes no identity and no price total", depPrice.length === price.length && near(metric(depPrice, "Total A value"), EXPECT_SUM_A) && near(metric(depPrice, "Total absolute difference"), EXPECT_ABS_DIFF));

// ===========================================================================
// Branch: Jev verdicts -> the Jev column appears (and only then)
// ===========================================================================
const jevResults = results.map((r) => ({ ...r }));
jevResults[0].jevVerdict = "MATCH"; jevResults[0].jevConfidence = 0.92; // 0-1 scale
jevResults[5].jevVerdict = "NOT_MATCH"; jevResults[5].jevConfidence = 88; // 0-100 scale
jevResults[10].jevVerdict = "UNCERTAIN"; jevResults[10].jevConfidence = 150; // clamped
const jevWb = XLSX.read(await buildReportBuffer(jevResults, stats, DEFAULT_SETTINGS, null), { type: "buffer" });
const jevAudit = sheetRows(jevWb, "Full Audit");
const jevHeader = jevAudit[0];
const jevCol = colIdx(jevHeader, "Jev Verdict");
const jevCell = (aRowNum) => jevAudit.find((r) => r && r[0] === aRowNum)[jevCol];
check("Jev Verdict column added when a row has a verdict", JSON.stringify(jevHeader) === JSON.stringify(EXPECT_JEV_HEADER), JSON.stringify(jevHeader));
check("Action List picks up the Jev column too", sheetRows(jevWb, "Action List")[0].includes("Jev Verdict") && sheetRows(jevWb, "Action List").length === 1 + PROBLEMS);
check("0-1 confidence rendered as a percentage", jevCell(2) === `MATCH ${DOT} 92%`, JSON.stringify(jevCell(2)));
check("0-100 confidence rendered as a percentage", jevCell(7) === `NOT_MATCH ${DOT} 88%`, JSON.stringify(jevCell(7)));
check("confidence clamped to 100%", jevCell(12) === `UNCERTAIN ${DOT} 100%`, JSON.stringify(jevCell(12)));
check("Jev cell blank for rows with no verdict", blank(jevCell(3)) && blank(jevCell(10)), `${JSON.stringify(jevCell(3))}/${JSON.stringify(jevCell(10))}`);
check("null file names render as an em dash", sheetRows(jevWb, "Summary").some((r) => r && r[0] === "File A (inventory/claim)" && r[1] === EM));

// ===========================================================================
if (failures) {
  console.error(`${failures} export checks failed`);
  process.exit(1);
}
console.log("\nall export checks passed");
fs.rmSync(outPath, { force: true });
