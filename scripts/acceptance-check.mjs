// Acceptance check: node scripts/acceptance-check.mjs
// Verifies the generated dummy-data corpus against the REAL .xlsx files using
// scripts/dummy-answer-key.json:
//   1. The answer-key "actual" statuses sum to the item total (5,000) and all
//      five statuses are present.
//   2. Spot-checks 5 random MATCH + 3 random MISMATCH items (seeded random for
//      reproducibility) against the raw spreadsheet cells, using cleanPrice /
//      normalizeDescription from src/lib/normalize.ts — the same functions the
//      app's matching engine uses.
// Exits 1 if any check fails.
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { cleanPrice, normalizeDescription } from "../src/lib/normalize.ts";

const OUT_DIR = "C:/Files-2.1";
const STATUSES = ["MATCH", "MISMATCH", "MULTIPLE", "NEEDS_REVIEW", "NOT_FOUND"];
const SPOT_SEED = 20260929;
const MATCH_SAMPLES = 5;
const MISMATCH_SAMPLES = 3;

// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
function check(label, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// Seeded PRNG so the spot-check sample is identical on every run.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededSample(items, count, seed) {
  const rng = mulberry32(seed);
  const pool = items.map((item, i) => ({ item, i }));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count).map((p) => p.item);
}

// ---------------------------------------------------------------------------
// Load the answer key and the two real workbooks.
const key = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "dummy-answer-key.json"), "utf8"),
);
const items = key.items;
console.log(
  `Answer key: ${items.length} items (generated ${key.generatedAt}, seed ${key.seed})`,
);

function readSheetRows(file, sheetName) {
  const wb = XLSX.read(fs.readFileSync(path.join(OUT_DIR, file)), { type: "buffer" });
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });
}
const rowsA = readSheetRows(key.files?.a ?? "masterlist.xlsx", "Masterlist");
const rowsB = readSheetRows(key.files?.b ?? "price_file_to_verify.xlsx", "Price File");
console.log(
  `File A "${key.files?.a ?? "masterlist.xlsx"}" (Masterlist): ${rowsA.length} rows; ` +
    `File B "${key.files?.b ?? "price_file_to_verify.xlsx"}" (Price File): ${rowsB.length} rows`,
);
// rows are 1-indexed spreadsheet rows (row 1 = header) in a 0-indexed array.
const cell = (rows, rowNum, col) => rows[rowNum - 1]?.[col] ?? null;

// ---- 1. Answer-key status totals ------------------------------------------
console.log("\nAnswer-key status totals:");
const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
let unknownStatus = 0;
for (const it of items) {
  if (counts[it.actual] === undefined) unknownStatus++;
  else counts[it.actual]++;
}
const statusSummary = STATUSES.map((s) => `${s}=${counts[s]}`).join(", ");
check(
  `statuses sum to total (${items.length})`,
  STATUSES.reduce((n, s) => n + counts[s], 0) === items.length,
  statusSummary,
);
check("all five statuses present", STATUSES.every((s) => counts[s] > 0), statusSummary);
check("every actual status is a known status", unknownStatus === 0, `${unknownStatus} unknown`);
console.log(`  ${statusSummary}`);

// ---- 2. Spot checks against the raw spreadsheets ---------------------------
const matchItems = items.filter((it) => it.actual === "MATCH");
const mismatchItems = items.filter((it) => it.actual === "MISMATCH");
const sample = [
  ...seededSample(matchItems, MATCH_SAMPLES, SPOT_SEED),
  ...seededSample(mismatchItems, MISMATCH_SAMPLES, SPOT_SEED + 1),
];

console.log(
  `\nSpot checks (seeded, seed=${SPOT_SEED}): ${MATCH_SAMPLES} MATCH + ${MISMATCH_SAMPLES} MISMATCH`,
);
for (const it of sample) {
  const tag = `${it.actual} aRow=${it.aRowNum} bRow=${it.bRowNum}`;
  const aNameCell = cell(rowsA, it.aRowNum, 0);
  const aPriceCell = cell(rowsA, it.aRowNum, 2);
  const bNameCell = cell(rowsB, it.bRowNum, 0);
  const bPriceCell = cell(rowsB, it.bRowNum, 2);

  // (a) A cell = code + name; the answer-key name must be contained in it.
  check(
    `${tag} (a) key name contained in A name cell`,
    aNameCell != null && String(aNameCell).includes(it.name),
    `A cell=${JSON.stringify(aNameCell)} key name=${JSON.stringify(it.name)}`,
  );

  // (b) The A price cell cleans to exactly the answer-key aPrice.
  const aCleaned = cleanPrice(aPriceCell);
  check(
    `${tag} (b) cleanPrice(A price cell) === aPrice`,
    aCleaned !== null && aCleaned === it.aPrice,
    `cell=${JSON.stringify(aPriceCell)} cleaned=${aCleaned} expected=${it.aPrice}`,
  );

  // (c) The chosen B row's name cell normalizes to the same value as the
  //     answer-key chosen bName.
  check(
    `${tag} (c) normalizeDescription(bName) === normalizeDescription(B name cell)`,
    normalizeDescription(it.bName) === normalizeDescription(bNameCell),
    `B cell=${JSON.stringify(bNameCell)} key bName=${JSON.stringify(it.bName)}`,
  );

  // (d) The B price cell cleans to exactly the answer-key bPrice.
  const bCleaned = cleanPrice(bPriceCell);
  check(
    `${tag} (d) cleanPrice(B price cell) === bPrice`,
    bCleaned !== null && bCleaned === it.bPrice,
    `cell=${JSON.stringify(bPriceCell)} cleaned=${bCleaned} expected=${it.bPrice}`,
  );

  // (e) Price relation implied by the status.
  if (it.actual === "MISMATCH") {
    check(
      `${tag} (e) MISMATCH: |bPrice - aPrice| > 0`,
      Math.abs(it.bPrice - it.aPrice) > 0,
      `aPrice=${it.aPrice} bPrice=${it.bPrice}`,
    );
  } else {
    check(
      `${tag} (e) MATCH: prices equal`,
      it.bPrice === it.aPrice,
      `aPrice=${it.aPrice} bPrice=${it.bPrice}`,
    );
  }
}

// ---- Summary ----------------------------------------------------------------
console.log(`\nSummary: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("ACCEPTANCE CHECK FAILED");
  process.exit(1);
}
console.log("ACCEPTANCE CHECK PASSED");
