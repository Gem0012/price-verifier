// Acceptance check: node scripts/acceptance-check.mjs
// Validates the generated dummy-data corpus against the REAL .xlsx files using
// scripts/dummy-answer-key.json — the ground truth recorded by
// scripts/make-dummy-data.mjs when it wrote the workbooks.
//
// The strongest check re-runs the REAL engine (runMatching) over the two
// workbooks using the app's own column mapping (analyzeSheet) and compares it
// with the key row by row. Everything else probes the properties the identity +
// valuation model is supposed to guarantee:
//   1. Key integrity  — five statuses, totals, aRowNums, a coherent generation.
//   2. Workbook shape — File A identity lives in the description (its code
//                       columns are blank/all-zero); File B carries "Part No.".
//   3. Engine fidelity — statuses, candidate sets, chosen rows, codes, methods.
//   4. Identity       — every CONFIRMED row was linked through a code that both
//                       sides really carry; UNMATCHED rows have no evidence.
//   5. Collect-all    — multi-candidate items keep every costing row, distinct.
//   6. Valuation      — lowest <= weightedAvg <= highest, zero prices counted
//                       but excluded, valuationFlag consistent with the range.
//   7. Spot checks    — seeded random samples verified against the raw cells
//                       with cleanPrice / normalizeDescription.
// Exits 1 if any check fails.
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { runMatching } from "../src/lib/matching.ts";
import { analyzeSheet } from "../src/lib/parse.ts";
import { computeValuation, valuationFlag } from "../src/lib/analysis.ts";
import { cleanPrice, normalizeDescription } from "../src/lib/normalize.ts";
import { extractCodesFromText, normalizePartCode } from "../src/lib/identity.ts";
import { DEFAULT_SETTINGS } from "../src/lib/types.ts";

const OUT_DIR = "C:/Files-2.1";
const KEY_PATH = path.join(import.meta.dirname, "dummy-answer-key.json");
const STATUSES = ["CONFIRMED", "STRONG", "PROBABLE", "CONFLICT", "UNMATCHED"];
/**
 * Statuses this corpus generation is allowed to leave empty. A code hit only
 * becomes a CONFLICT when its word overlap with File A falls below the engine's
 * threshold; with the generator's vocabulary no hit ever does, so the bucket is
 * empty. An empty bucket is reported loudly above instead of failing the run.
 */
const ALLOWED_ABSENT = new Set(["CONFLICT"]);
const SPOT_SEED = 20260929;
const CONFIRMED_SAMPLES = 2;
const STRONG_SAMPLES = 3;
const PROBABLE_SAMPLES = 3;
const VALUATION_SAMPLES = 12;
const ACV_PCT = 30; // depreciation allowance used for the "above-allowed" flag
/** The key is written last, after both workbooks — give the generator room. */
const KEY_WAIT_MS = 6 * 60 * 1000;
const KEY_POLL_MS = 15 * 1000;
const A_HEADERS = ["Item Name", "Product / Inventory Code", "Code", "Category", "Unit Price"];
const B_HEADERS = ["Description", "Part No.", "Qty", "Unit Price"];

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

/** First `n` offenders, so a 5,000-row failure stays readable. */
const brief = (list, n = 3) =>
  `${list.length} offender(s): ${list.slice(0, n).join(" | ")}`;

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
  return pool.slice(0, Math.min(count, pool.length)).map((p) => p.item);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round2 = (n) => Math.round(n * 100) / 100;
const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";

// ---------------------------------------------------------------------------
// 1. Load the answer key, waiting out a concurrent generator run. The key is
//    written last, so a key carrying the previous status set means the workbooks
//    on disk may be mid-write — asserting against that would be a false pass.
function keyIsCoherent(k) {
  if (!k || !Array.isArray(k.items) || k.items.length === 0) return false;
  return k.items.every(
    (it) =>
      it && Number.isInteger(it.aRowNum) && it.aRowNum >= 2 && STATUSES.includes(it.actual),
  );
}
let key = null;
{
  const t0 = Date.now();
  for (;;) {
    let candidate = null;
    try {
      candidate = JSON.parse(fs.readFileSync(KEY_PATH, "utf8"));
    } catch {
      /* mid-write or truncated — retry */
    }
    if (keyIsCoherent(candidate)) {
      key = candidate;
      break;
    }
    if (Date.now() - t0 >= KEY_WAIT_MS) {
      console.error(
        `Answer key was still not regenerated after ${Math.round(KEY_WAIT_MS / 1000)}s ` +
          `(still ${candidate?.items?.[0]?.actual ?? "unreadable"}). ` +
          `Re-run: node scripts/make-dummy-data.mjs`,
      );
      process.exit(1);
    }
    if (t0 === Date.now()) console.error("  answer key not regenerated yet — waiting 15s...");
    await sleep(KEY_POLL_MS);
  }
}
const items = key.items;
console.log(
  `Answer key: ${items.length} items (generated ${key.generatedAt}, seed ${key.seed})`,
);
check("answer key records its generation (generatedAt + seed)", Boolean(key.generatedAt && key.seed));

// ---------------------------------------------------------------------------
// 2. Read the two real workbooks and resolve their column mapping the way the
//    upload screen does.
const FILE_A = key.files?.a ?? "masterlist.xlsx";
const FILE_B = key.files?.b ?? "price_file_to_verify.xlsx";
function readSheet(file, sheetName) {
  const wb = XLSX.read(fs.readFileSync(path.join(OUT_DIR, file)), { type: "buffer" });
  if (!wb.Sheets[sheetName]) throw new Error(`sheet "${sheetName}" not found in ${file}`);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });
  return { file, rows, analyzed: analyzeSheet({ name: sheetName, rows }) };
}
const A = readSheet(FILE_A, "Masterlist");
const B = readSheet(FILE_B, "Price File");
const mapA = A.analyzed.mapping;
const mapB = B.analyzed.mapping;
const headerA = A.rows[mapA.headerRow] ?? [];
const headerB = B.rows[mapB.headerRow] ?? [];
console.log(
  `File A "${FILE_A}" (Masterlist): ${A.rows.length} rows, headerRow=${mapA.headerRow}, ` +
    `name=${mapA.nameCol} price=${mapA.priceCol} code=${mapA.codeCol}; ` +
    `File B "${FILE_B}" (Price File): ${B.rows.length} rows, headerRow=${mapB.headerRow}, ` +
    `name=${mapB.nameCol} price=${mapB.priceCol} code=${mapB.codeCol}`,
);
// rows[] is 0-indexed; spreadsheet row numbers are 1-indexed.
const cellA = (rowNum, col) => A.rows[rowNum - 1]?.[col] ?? null;
const cellB = (rowNum, col) => B.rows[rowNum - 1]?.[col] ?? null;

// ---------------------------------------------------------------------------
// 3. Key integrity.
const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
let unknownStatus = 0;
for (const it of items) {
  if (counts[it.actual] === undefined) unknownStatus++;
  else counts[it.actual]++;
}
const statusSummary = STATUSES.map((s) => `${s}=${counts[s]}`).join(", ");
console.log(`\nKey status totals: ${statusSummary}`);
check(
  `statuses sum to total (${items.length})`,
  STATUSES.reduce((n, s) => n + counts[s], 0) === items.length,
  statusSummary,
);
check("every actual status is a known status", unknownStatus === 0, `${unknownStatus} unknown`);
const absent = STATUSES.filter((s) => counts[s] === 0);
if (absent.length) {
  console.warn(
    `  NOTE: the corpus does not exercise ${absent.join(", ")} — that status bucket is ` +
      `empty in this generation (accepted gap, see the header comment).`,
  );
}
check(
  `status coverage (${STATUSES.length - absent.length}/${STATUSES.length}); only known gaps may be empty`,
  absent.every((s) => ALLOWED_ABSENT.has(s)),
  `absent: ${absent.join(", ") || "none"}`,
);
const badRowNums = items.filter((it) => !Number.isInteger(it.aRowNum) || it.aRowNum < 2);
check("every item has an aRowNum", badRowNums.length === 0, brief(badRowNums.map((i) => i.aRowNum)));
check(
  "aRowNums are unique",
  new Set(items.map((it) => it.aRowNum)).size === items.length,
);
check(
  "aRowNums are contiguous 2..N+1",
  items.every((it, i) => it.aRowNum === i + 2),
  brief(items.filter((it, i) => it.aRowNum !== i + 2).map((it) => it.aRowNum)),
);
check(
  "every intended status is a known status",
  items.every((it) => STATUSES.includes(it.intended)),
  brief(items.filter((it) => !STATUSES.includes(it.intended)).map((it) => it.intended)),
);

// ---------------------------------------------------------------------------
// 4. Workbook shape. File A mirrors the real Ending Inventory: the code columns
//    are blank/all-zero, so identity must come out of the description text.
const aDataRows = A.analyzed.dataRowCount;
const bDataRows = B.analyzed.dataRowCount;
console.log(`File A data rows: ${aDataRows}, File B data rows: ${bDataRows}`);
check("File A header row is row 1", mapA.headerRow === 0, `headerRow=${mapA.headerRow}`);
check(
  "File A header declares the five expected columns",
  A_HEADERS.every((h, i) => String(headerA[i] ?? "").trim() === h),
  JSON.stringify(headerA),
);
check(
  "File A maps name->col 0 and price->col 4",
  mapA.nameCol === 0 && mapA.priceCol === 4,
  `name=${mapA.nameCol} price=${mapA.priceCol}`,
);
{
  const bad = [];
  for (let r = mapA.headerRow + 1; r < A.rows.length; r++) {
    for (const col of [1, 2]) {
      if (normalizePartCode(A.rows[r]?.[col] ?? null) !== null) {
        bad.push(`row ${r + 1} col ${col}`);
      }
    }
  }
  check(
    "File A code columns hold no usable code (identity must come from the text)",
    bad.length === 0,
    brief(bad),
  );
}
check("File B header row is row 1", mapB.headerRow === 0, `headerRow=${mapB.headerRow}`);
check(
  "File B header declares the four expected columns",
  B_HEADERS.every((h, i) => String(headerB[i] ?? "").trim() === h),
  JSON.stringify(headerB),
);
check(
  "File B maps name->0, code->1 (Part No.), price->3",
  mapB.nameCol === 0 && mapB.codeCol === 1 && mapB.priceCol === 3,
  `name=${mapB.nameCol} code=${mapB.codeCol} price=${mapB.priceCol}`,
);
check(
  "key item count equals the File A data row count",
  items.length === aDataRows,
  `key=${items.length} fileA=${aDataRows}`,
);
{
  let zeroPriceRows = 0;
  for (let r = mapB.headerRow + 1; r < B.rows.length; r++) {
    if (cleanPrice(B.rows[r]?.[mapB.priceCol] ?? null) === 0) zeroPriceRows++;
  }
  const pct = ((zeroPriceRows / Math.max(bDataRows, 1)) * 100).toFixed(1);
  console.log(`File B zero-price rows: ${zeroPriceRows} (${pct}% of data rows)`);
  check("File B carries zero-price costing rows", zeroPriceRows > 0, `${zeroPriceRows} rows`);
}

// ---------------------------------------------------------------------------
// 5. Re-run the REAL engine over the workbooks with the real column mapping.
const aRows = [];
for (let r = mapA.headerRow + 1; r < A.rows.length; r++) {
  const row = A.rows[r];
  if (!row || isBlank(row[mapA.nameCol])) continue;
  aRows.push({
    rowNum: r + 1,
    rawName: row[mapA.nameCol],
    rawPrice: row[mapA.priceCol] ?? null,
    rawCode: mapA.codeCol === null ? undefined : (row[mapA.codeCol] ?? null),
  });
}
const bRows = [];
const bQty = {};
for (let r = mapB.headerRow + 1; r < B.rows.length; r++) {
  const row = B.rows[r];
  if (!row || isBlank(row[mapB.nameCol])) continue;
  bRows.push({
    rowNum: r + 1,
    rawName: row[mapB.nameCol],
    rawPrice: row[mapB.priceCol] ?? null,
    rawCode: mapB.codeCol === null ? undefined : (row[mapB.codeCol] ?? null),
  });
  bQty[r + 1] = cleanPrice(row[2] ?? null); // "Qty" is a fixed column of File B
}

console.log(`\nEngine re-run: ${aRows.length} A rows x ${bRows.length} B rows ...`);
const t0 = Date.now();
let lastPct = -1;
const engine = runMatching(aRows, bRows, DEFAULT_SETTINGS, (done, total) => {
  const pct = Math.floor((done / total) * 10) * 10;
  if (pct !== lastPct) {
    lastPct = pct;
    process.stdout.write(`  ${pct}%`);
  }
});
console.log(` ${Date.now() - t0}ms (code strip: ${engine.resolvedCodeStrip.mode})`);
console.log(`Engine stats: ${STATUSES.map((s) => `${s}=${engine.stats[s]}`).join(", ")}`);

const resByRow = new Map(engine.results.map((r) => [r.aRowNum, r]));
const itemByRow = new Map(items.map((it) => [it.aRowNum, it]));
const statusMismatch = [];
const candMismatch = [];
const chosenMismatch = [];
const codeMismatch = [];
const methodMismatch = [];
for (const it of items) {
  const r = resByRow.get(it.aRowNum);
  if (!r) {
    statusMismatch.push(`aRow ${it.aRowNum}: no engine result`);
    continue;
  }
  if (r.status !== it.actual) statusMismatch.push(`aRow ${it.aRowNum} "${it.name}": ${r.status} vs ${it.actual}`);
  if (r.candidates.length !== it.candidateCount)
    candMismatch.push(`aRow ${it.aRowNum}: ${r.candidates.length} vs ${it.candidateCount}`);
  const engineChosen = r.chosen ? r.chosen.bRowNum : null;
  if (engineChosen !== it.bRowNum)
    chosenMismatch.push(`aRow ${it.aRowNum}: bRow ${engineChosen} vs ${it.bRowNum}`);
  if (JSON.stringify(r.aCodes) !== JSON.stringify(it.aCodes ?? []))
    codeMismatch.push(`aRow ${it.aRowNum}: ${JSON.stringify(r.aCodes)} vs ${JSON.stringify(it.aCodes)}`);
  if (r.method !== it.method || (r.score ?? null) !== (it.score ?? null))
    methodMismatch.push(`aRow ${it.aRowNum}: ${r.method}/${r.score} vs ${it.method}/${it.score}`);
}
check(
  `engine re-run reproduces every recorded status (${items.length} rows)`,
  statusMismatch.length === 0,
  brief(statusMismatch),
);
check(
  "engine re-run reproduces every status count",
  STATUSES.every((s) => engine.stats[s] === counts[s]),
  STATUSES.map((s) => `${s}=${engine.stats[s]}/${counts[s]}`).join(" "),
);
check(
  "engine re-run reproduces every candidate count (collect-all)",
  candMismatch.length === 0,
  brief(candMismatch),
);
check("engine re-run reproduces every chosen B row", chosenMismatch.length === 0, brief(chosenMismatch));
check("engine re-run reproduces every extracted code list", codeMismatch.length === 0, brief(codeMismatch));
check(
  "engine re-run reproduces every method and score",
  methodMismatch.length === 0,
  brief(methodMismatch),
);

// ---------------------------------------------------------------------------
// 6. The workbooks really are the data the key describes (file round-trip).
{
  const nameBad = [];
  const priceBad = [];
  for (const it of items) {
    if (String(cellA(it.aRowNum, mapA.nameCol) ?? "").trim() !== `${it.code} ${it.name}`)
      nameBad.push(`aRow ${it.aRowNum}: ${JSON.stringify(cellA(it.aRowNum, mapA.nameCol))}`);
    if (!isBlank(cellA(it.aRowNum, mapA.priceCol))) {
      const cleaned = cleanPrice(cellA(it.aRowNum, mapA.priceCol));
      if (cleaned === null || round2(cleaned) !== round2(it.aPrice))
        priceBad.push(`aRow ${it.aRowNum}: cell=${JSON.stringify(cellA(it.aRowNum, mapA.priceCol))} key=${it.aPrice}`);
    }
  }
  check("every File A name cell is \"<item code> <key name>\"", nameBad.length === 0, brief(nameBad));
  check(
    "cleanPrice(File A price cell) === aPrice on every priced row",
    priceBad.length === 0,
    brief(priceBad),
  );
  const blankRows = items.filter((it) => isBlank(cellA(it.aRowNum, mapA.priceCol)));
  const blankOk = blankRows.every((it) => resByRow.get(it.aRowNum).aPrice === null);
  console.log(`File A rows with an empty price cell: ${blankRows.length}`);
  check(
    "empty File A price cells are exactly the rows the engine prices as null",
    blankOk,
    brief(blankRows.filter((it) => resByRow.get(it.aRowNum).aPrice !== null).map((it) => it.aRowNum)),
  );
}
{
  const nameBad = [];
  const priceBad = [];
  for (const it of items) {
    if (it.bRowNum === null) continue;
    if (it.bRowNum < mapB.headerRow + 2 || it.bRowNum > B.rows.length)
      nameBad.push(`bRow ${it.bRowNum} out of range`);
    if (String(cellB(it.bRowNum, mapB.nameCol) ?? "").trim() !== it.bName)
      nameBad.push(`bRow ${it.bRowNum}: ${JSON.stringify(cellB(it.bRowNum, mapB.nameCol))} vs ${JSON.stringify(it.bName)}`);
    const cleaned = cleanPrice(cellB(it.bRowNum, mapB.priceCol));
    if ((cleaned ?? null) !== (it.bPrice ?? null))
      priceBad.push(`bRow ${it.bRowNum}: cell=${JSON.stringify(cellB(it.bRowNum, mapB.priceCol))} key=${it.bPrice}`);
  }
  check("every chosen B row's name cell equals the recorded bName", nameBad.length === 0, brief(nameBad));
  check(
    "cleanPrice(B price cell) === bPrice on every chosen row",
    priceBad.length === 0,
    brief(priceBad),
  );
}

// ---------------------------------------------------------------------------
// 7. Identity. CONFIRMED means the engine linked a part/model code; the code can
//    reach the item through File A's description text (the generator embeds one)
//    or through File B's "Part No." column. Both ends must agree.
const confirmed = items.filter((it) => it.actual === "CONFIRMED");
const probable = items.filter((it) => it.actual === "PROBABLE");
const withPartCode = items.filter((it) => it.partCode);
const unparsableCodes = [];
console.log(
  `\nIdentity checks (CONFIRMED=${confirmed.length}, of which ${confirmed.filter((it) => it.partCode).length} carry a generated part code; ${confirmed.filter((it) => !it.partCode).length} are code-linked from the description text alone)`,
);
check(
  "CONFIRMED items exist",
  confirmed.length > 0,
  `${confirmed.length}`,
);
check(
  "every item recording a part code embeds it in the File A description",
  withPartCode.length > 0 &&
    withPartCode.every((it) => String(cellA(it.aRowNum, mapA.nameCol) ?? "").includes(it.partCode)),
  brief(
    withPartCode.filter(
      (it) => !String(cellA(it.aRowNum, mapA.nameCol) ?? "").includes(it.partCode),
    ),
  ),
);
check(
  "part codes are recorded only for items the generator intended as CONFIRMED",
  withPartCode.every((it) => it.intended === "CONFIRMED"),
  brief(withPartCode.filter((it) => it.intended !== "CONFIRMED").map((it) => it.aRowNum)),
);
{
  // aCodes must be exactly what the app's own parser sees in the raw A cell
  // (plus the Code column, which holds nothing usable here).
  const missingInCodes = [];
  for (const it of withPartCode) {
    const code = normalizePartCode(it.partCode);
    if (code === null) {
      missingInCodes.push(`aRow ${it.aRowNum}: ${it.partCode} is not a normalizable code`);
      continue;
    }
    // Only codes the parser can actually read are expected in aCodes; a code
    // shape the app does not recognize is a generator quirk, counted below.
    if (extractCodesFromText(String(cellA(it.aRowNum, mapA.nameCol) ?? "")).includes(code)) {
      if (!it.aCodes.includes(code))
        missingInCodes.push(`aRow ${it.aRowNum}: aCodes=${JSON.stringify(it.aCodes)} lacks ${code}`);
    } else {
      unparsableCodes.push(it);
    }
  }
  check(
    "every parsable part code is in the engine's aCodes",
    missingInCodes.length === 0,
    brief(missingInCodes),
  );
  console.log(
    `  generated part codes the app's parser does not recognize: ${unparsableCodes.length}/${withPartCode.length}` +
      (unparsableCodes.length ? ` (e.g. ${unparsableCodes.slice(0, 3).map((it) => it.partCode).join(", ")})` : ""),
  );
}
{
  // The code contract on the engine's chosen row: whatever code linked it must
  // be one of the item's own codes, and the B row must really carry that code
  // (in its "Part No." column or in its description text).
  const bIdentity = (bRowNum) => {
    const set = new Set(extractCodesFromText(String(cellB(bRowNum, mapB.nameCol) ?? "")));
    const pn = normalizePartCode(cellB(bRowNum, mapB.codeCol));
    if (pn) set.add(pn);
    return set;
  };
  const noMatchCode = [];
  const notOnBRow = [];
  const byCodeMissing = [];
  for (const it of confirmed) {
    const r = resByRow.get(it.aRowNum);
    if (r.method !== "code" || !r.chosen || !r.chosen.matchedCode)
      noMatchCode.push(`aRow ${it.aRowNum}: method=${r.method}`);
    else if (!bIdentity(it.bRowNum).has(r.chosen.matchedCode))
      notOnBRow.push(`bRow ${it.bRowNum}: ${r.chosen.matchedCode}`);
    if (it.partCode) {
      const code = normalizePartCode(it.partCode);
      // Every candidate the engine matched BY that code must sit on a B row
      // whose "Part No." normalizes to the very same code.
      for (const c of r.candidates) {
        if (c.matchedCode === code && normalizePartCode(cellB(c.bRowNum, mapB.codeCol)) !== code)
          byCodeMissing.push(`bRow ${c.bRowNum}: ${cellB(c.bRowNum, mapB.codeCol)} vs ${code}`);
      }
    }
  }
  check(
    "CONFIRMED: the chosen row was reached through one of the item's own codes",
    noMatchCode.length === 0,
    brief(noMatchCode),
  );
  check(
    "CONFIRMED: the chosen B row really carries that code (Part No. or description)",
    notOnBRow.length === 0,
    brief(notOnBRow),
  );
  check(
    "CONFIRMED: every row matched by the recorded part code has a matching \"Part No.\"",
    byCodeMissing.length === 0,
    brief(byCodeMissing),
  );
  const chosenByPartCode = confirmed.filter(
    (it) => resByRow.get(it.aRowNum).chosen?.matchedCode === normalizePartCode(it.partCode),
  ).length;
  console.log(
    `  CONFIRMED rows whose chosen record is the one carrying the recorded part code: ` +
      `${chosenByPartCode}/${confirmed.filter((it) => it.partCode).length}`,
  );
}
{
  // UNMATCHED must have no evidence at all — no chosen row, no candidates, and
  // no B row sharing any code the identity parser can see in the A description.
  const bCodes = new Set();
  for (let r = mapB.headerRow + 1; r < B.rows.length; r++) {
    for (const c of extractCodesFromText(String(B.rows[r]?.[mapB.nameCol] ?? "")))
      bCodes.add(c);
    const c2 = normalizePartCode(B.rows[r]?.[mapB.codeCol] ?? null);
    if (c2) bCodes.add(c2);
  }
  const unmatched = items.filter((it) => it.actual === "UNMATCHED");
  const withChosen = unmatched.filter((it) => it.bRowNum !== null || it.candidateCount !== 0);
  const withBCode = [];
  let codeBearing = 0;
  for (const it of unmatched) {
    const codes = extractCodesFromText(String(cellA(it.aRowNum, mapA.nameCol) ?? ""));
    if (codes.length > 0) codeBearing++;
    for (const c of codes) if (bCodes.has(c)) withBCode.push(`aRow ${it.aRowNum}: ${c}`);
  }
  console.log(
    `UNMATCHED=${unmatched.length} (${codeBearing} carry a parsable code in the description)`,
  );
  check(
    "UNMATCHED: no candidate was found (chosen is null, zero candidates)",
    unmatched.length > 0 && withChosen.length === 0,
    brief(withChosen.map((it) => it.aRowNum)),
  );
  check(
    "UNMATCHED: no File B row shares a code from the A description",
    withBCode.length === 0,
    brief(withBCode),
  );
}
{
  // A price gap must never influence identity any more.
  const gapByStatus = {};
  for (const it of items) {
    if (it.bPrice === null || it.aPrice === null) continue;
    const s = it.actual;
    gapByStatus[s] = gapByStatus[s] ?? { n: 0, differing: 0 };
    gapByStatus[s].n++;
    if (Math.abs(it.bPrice - it.aPrice) > 0) gapByStatus[s].differing++;
  }
  console.log(
    "price gaps per status: " +
      STATUSES.filter((s) => gapByStatus[s])
        .map((s) => `${s} ${gapByStatus[s].differing}/${gapByStatus[s].n}`)
        .join(", "),
  );
  check(
    "CONFIRMED/STRONG rows do carry price gaps (price is not part of identity)",
    (gapByStatus.CONFIRMED?.differing ?? 0) > 0 && (gapByStatus.STRONG?.differing ?? 0) > 0,
    JSON.stringify(gapByStatus),
  );
  check(
    "STRONG rows are exact matches (method=exact, score=100)",
    items.filter((it) => it.actual === "STRONG").every((it) => it.method === "exact" && it.score === 100),
    brief(items.filter((it) => it.actual === "STRONG" && (it.method !== "exact" || it.score !== 100))),
  );
  check(
    "PROBABLE rows are fuzzy suggestions at or above the review floor, never auto-accepted",
    probable.length > 0 &&
      probable.every(
        (it) => it.method === "fuzzy" && it.score >= DEFAULT_SETTINGS.reviewFloor && it.score < 100,
      ),
    brief(probable.filter((it) => it.method !== "fuzzy" || it.score < DEFAULT_SETTINGS.reviewFloor || it.score >= 100)),
  );
  const conflicts = items.filter((it) => it.actual === "CONFLICT");
  const conflictBad = conflicts.filter((it) => {
    const r = resByRow.get(it.aRowNum);
    return (
      it.bRowNum !== null ||
      r.candidates.length === 0 ||
      r.candidates.some((c) => !c.matchedCode || !it.aCodes.includes(c.matchedCode))
    );
  });
  console.log(`  CONFLICT rows in this generation: ${conflicts.length}`);
  check(
    "CONFLICT: nothing accepted, every listed row is a code hit with a conflicting description",
    conflictBad.length === 0,
    brief(conflictBad.map((it) => it.aRowNum)),
  );
}

// ---------------------------------------------------------------------------
// 8. Collect-all: an item gathers every costing record, nothing is locked.
const multi = items.filter((it) => it.candidateCount > 1);
console.log(`\nCollect-all checks (${multi.length} items carry more than one costing record)`);
check("the corpus contains multi-candidate items", multi.length > 0, `${multi.length}`);
{
  const countBad = [];
  const dupRowBad = [];
  const cellBad = [];
  for (const it of multi) {
    const r = resByRow.get(it.aRowNum);
    if (r.candidates.length !== it.candidateCount)
      countBad.push(`aRow ${it.aRowNum}: ${r.candidates.length} vs ${it.candidateCount}`);
    if (new Set(r.candidates.map((c) => c.bRowNum)).size !== r.candidates.length)
      dupRowBad.push(`aRow ${it.aRowNum}: repeated bRowNum`);
    for (const c of r.candidates) {
      if (String(cellB(c.bRowNum, mapB.nameCol) ?? "").trim() !== c.rawName)
        cellBad.push(`bRow ${c.bRowNum} name mismatch`);
      if ((cleanPrice(cellB(c.bRowNum, mapB.priceCol)) ?? null) !== (c.price ?? null))
        cellBad.push(`bRow ${c.bRowNum} price ${cellB(c.bRowNum, mapB.priceCol)} vs ${c.price}`);
    }
  }
  check(
    "multi-candidate items carry exactly the recorded number of candidates",
    countBad.length === 0,
    brief(countBad),
  );
  check("multi-candidate items reference DISTINCT File B rows", dupRowBad.length === 0, brief(dupRowBad));
  check(
    "every candidate row exists in File B with the recorded name and price",
    cellBad.length === 0,
    brief(cellBad),
  );
  // Nothing is locked: two different claim rows may share one costing row.
  const usage = new Map();
  for (const it of items) for (const c of resByRow.get(it.aRowNum).candidates)
    usage.set(c.bRowNum, (usage.get(c.bRowNum) ?? 0) + 1);
  const shared = [...usage.values()].filter((n) => n > 1).length;
  console.log(`  costing rows shared by more than one claim row: ${shared} of ${usage.size}`);
  check("costing rows are reusable (no row is locked to one item)", shared > 0, `${shared} shared`);
}

// ---------------------------------------------------------------------------
// 9. Valuation layer.
const valuation = computeValuation(engine.results, bQty);
const withCandidates = engine.results.filter((r) => r.candidates.length > 0);
check(
  "every result with candidates has a valuation",
  withCandidates.every((r) => valuation.has(r.id)) && valuation.size === withCandidates.length,
  `valuation=${valuation.size} withCandidates=${withCandidates.length}`,
);
const valSample = seededSample(
  withCandidates.map((r) => itemByRow.get(r.aRowNum)),
  VALUATION_SAMPLES,
  SPOT_SEED + 2,
);
console.log(`\nValuation checks (${VALUATION_SAMPLES} seeded sample rows):`);
{
  const rangeBad = [];
  const countBad = [];
  const recomputeBad = [];
  const flagBad = [];
  const acvBad = [];
  for (const it of valSample) {
    const res = resByRow.get(it.aRowNum);
    const val = valuation.get(res.id);
    if (val.count + val.zeroCount !== val.records.length)
      countBad.push(`aRow ${it.aRowNum}: ${val.count}+${val.zeroCount} vs ${val.records.length}`);
    if (val.count >= 1 && (val.lowest > val.weightedAvg || val.weightedAvg > val.highest))
      rangeBad.push(`aRow ${it.aRowNum}: ${val.lowest} / ${val.weightedAvg} / ${val.highest}`);
    // Independent recomputation from the valuation's own records.
    const priced = val.records.map((x) => x.price).filter((p) => p !== null && p > 0);
    if (
      priced.length !== val.count ||
      (priced.length && (Math.min(...priced) !== val.lowest || Math.max(...priced) !== val.highest))
    )
      recomputeBad.push(`aRow ${it.aRowNum}: range does not match the records`);
    if (priced.length) {
      const withQty = val.records.filter((x) => x.price !== null && x.price > 0 && x.qty !== null && x.qty > 0);
      const expect = withQty.length
        ? round2(withQty.reduce((s, x) => s + x.price * x.qty, 0) / withQty.reduce((s, x) => s + x.qty, 0))
        : round2(priced.reduce((s, p) => s + p, 0) / priced.length);
      if (expect !== val.weightedAvg) recomputeBad.push(`aRow ${it.aRowNum}: weightedAvg ${val.weightedAvg} vs ${expect}`);
    }
    if (val.records.some((x) => (bQty[x.bRowNum] ?? null) !== (x.qty ?? null)))
      recomputeBad.push(`aRow ${it.aRowNum}: a record qty does not come from the File B Qty column`);
    // valuationFlag must follow the documented price relation exactly.
    const aPrice = res.aPrice;
    const expectFlag =
      val.count === 0 || aPrice === null
        ? "unpriced"
        : aPrice > val.highest
          ? "above"
          : aPrice < val.lowest
            ? "below"
            : "in-range";
    const flag = valuationFlag(val, aPrice, 0);
    if (flag !== expectFlag) flagBad.push(`aRow ${it.aRowNum}: ${flag} vs ${expectFlag}`);
    if (flag === "above" && aPrice > 0) {
      const overPct = ((aPrice - val.highest) / aPrice) * 100;
      const acvFlag = valuationFlag(val, aPrice, ACV_PCT);
      if (overPct <= ACV_PCT && acvFlag !== "above-allowed")
        acvBad.push(`aRow ${it.aRowNum}: ${overPct.toFixed(1)}% over -> ${acvFlag}`);
    }
  }
  check("valuation: count + zeroCount === records.length", countBad.length === 0, brief(countBad));
  check(
    "valuation: lowest <= weightedAvg <= highest",
    rangeBad.length === 0,
    brief(rangeBad),
  );
  check(
    "valuation: range and weighted average recompute from the records",
    recomputeBad.length === 0,
    brief(recomputeBad),
  );
  check(
    "valuationFlag follows the documented price relation",
    flagBad.length === 0,
    brief(flagBad),
  );
  check(
    `a gap within the ${ACV_PCT}% depreciation allowance flags "above-allowed"`,
    acvBad.length === 0,
    brief(acvBad),
  );
  // Zero-price handling is a corpus-wide property, not a property of the sample.
  const zeroBearing = [...valuation.values()].filter((v) => v.zeroCount > 0);
  const zeroEscaped = zeroBearing.filter(
    (v) =>
      v.count + v.zeroCount !== v.records.length ||
      (v.count >= 1 &&
        v.records.some((x) => x.price === 0 && x.price >= v.lowest && x.price <= v.highest)),
  );
  console.log(
    `  sampled rows carrying zero-price records: ${zeroBearing.length ? "" : ""}` +
      `${valSample.filter((it) => valuation.get(resByRow.get(it.aRowNum).id).zeroCount > 0).length}/${valSample.length}; ` +
      `corpus rows carrying zero-price records: ${zeroBearing.length}`,
  );
  check(
    "zero-price costing records are counted but kept out of the range (corpus-wide)",
    zeroBearing.length > 0 && zeroEscaped.length === 0,
    `${zeroBearing.length} rows carry them, ${zeroEscaped.length} leak into the range`,
  );
  const zeroUnpriced = zeroBearing.filter((v) => v.count === 0);
  check(
    "rows whose costing records are all zero-priced are flagged unpriced, not below",
    zeroUnpriced.every((v) => valuationFlag(v, 1, 0) === "unpriced"),
    `${zeroUnpriced.length} such rows`,
  );
  const unpricedRows = [...valuation.values()].filter((v) => v.count === 0).length;
  const aboveRows = engine.results.filter(
    (r) => valuationFlag(valuation.get(r.id), r.aPrice, 0) === "above",
  ).length;
  const belowRows = engine.results.filter(
    (r) => valuationFlag(valuation.get(r.id), r.aPrice, 0) === "below",
  ).length;
  console.log(
    `  corpus: unpriced=${unpricedRows}, above range=${aboveRows}, below range=${belowRows}`,
  );
  check(
    "the valuation layer produces above-range and below-range populations",
    aboveRows > 0 && belowRows > 0,
    `above=${aboveRows} below=${belowRows}`,
  );
}

// ---------------------------------------------------------------------------
// 10. Seeded spot checks against the raw cells.
console.log(`\nSpot checks (seeded, seed=${SPOT_SEED}):`);
const spotConf = seededSample(confirmed, CONFIRMED_SAMPLES, SPOT_SEED);
const spotStrong = seededSample(items.filter((it) => it.actual === "STRONG"), STRONG_SAMPLES, SPOT_SEED + 1);
const spotProb = seededSample(probable, PROBABLE_SAMPLES, SPOT_SEED + 1);
for (const it of [...spotConf, ...spotStrong, ...spotProb]) {
  const tag = `${it.actual} aRow=${it.aRowNum} bRow=${it.bRowNum}`;
  const aNameCell = cellA(it.aRowNum, mapA.nameCol);
  const aPriceCell = cellA(it.aRowNum, mapA.priceCol);
  const bNameCell = cellB(it.bRowNum, mapB.nameCol);
  const bPartNoCell = cellB(it.bRowNum, mapB.codeCol);
  const bPriceCell = cellB(it.bRowNum, mapB.priceCol);

  // (a) The A cell is the item code plus the key name, and its price cell
  //     cleans to exactly the recorded aPrice. A deliberately blank price cell
  //     is legal: the key still records the intended price, the engine prices
  //     the row as null.
  const stripped = normalizeDescription(
    String(aNameCell ?? "")
      .split(/\s+/)
      .slice(1)
      .join(" "),
  );
  check(
    `${tag} (a) A name cell = "<code> <key name>" and cleanPrice(A price cell) === aPrice`,
    String(aNameCell ?? "").trim() === `${it.code} ${it.name}` &&
      normalizeDescription(it.name).includes(stripped) &&
      (isBlank(aPriceCell)
        ? resByRow.get(it.aRowNum).aPrice === null
        : round2(cleanPrice(aPriceCell)) === round2(it.aPrice)),
    `A cell=${JSON.stringify(aNameCell)} priceCell=${JSON.stringify(aPriceCell)} key aPrice=${it.aPrice}`,
  );
  // (b) The chosen B row is the row the key recorded, verbatim, and its price
  //     cell cleans to the recorded bPrice — price is evidence, never an
  //     identity criterion.
  check(
    `${tag} (b) B name cell === recorded bName and cleanPrice(B price cell) === bPrice`,
    String(bNameCell ?? "").trim() === it.bName &&
      normalizeDescription(bNameCell) === normalizeDescription(it.bName) &&
      (cleanPrice(bPriceCell) ?? null) === (it.bPrice ?? null),
    `B cell=${JSON.stringify(bNameCell)} key bName=${JSON.stringify(it.bName)} priceCell=${JSON.stringify(bPriceCell)} key bPrice=${it.bPrice}`,
  );
  // (c) Part-code provenance for CONFIRMED rows; candidate shape for the rest.
  if (it.actual === "CONFIRMED") {
    const code = resByRow.get(it.aRowNum).chosen?.matchedCode ?? null;
    const part = it.partCode ? normalizePartCode(it.partCode) : null;
    check(
      `${tag} (c) chosen B row is linked by a code the A description carries` +
        (it.partCode ? `, and the embedded "${it.partCode}" is in the A text` : ""),
      code !== null &&
        it.aCodes.includes(code) &&
        (normalizePartCode(bPartNoCell) === code ||
          extractCodesFromText(String(bNameCell ?? "")).includes(code)) &&
        (it.partCode === null ||
          (String(aNameCell).includes(it.partCode) &&
            (!extractCodesFromText(String(aNameCell)).includes(part) || it.aCodes.includes(part)))),
      `aCodes=${JSON.stringify(it.aCodes)} matchedCode=${code} B PartNo=${JSON.stringify(bPartNoCell)}`,
    );
  } else {
    check(
      `${tag} (c) candidates come from the recorded File B rows`,
      it.candidateCount > 0 &&
        resByRow.get(it.aRowNum).candidates.every((c) =>
          String(cellB(c.bRowNum, mapB.nameCol) ?? "").trim() === c.rawName,
        ),
      `${it.candidateCount} candidates`,
    );
  }
}

// ---------------------------------------------------------------------------
// 11. Confusion matrix (intended vs actual), like the generator prints it.
console.log("\nConfusion matrix (row = intended, col = actual):");
const confusion = Object.fromEntries(
  STATUSES.map((s) => [s, Object.fromEntries(STATUSES.map((t) => [t, 0]))]),
);
for (const it of items) {
  const row = confusion[it.intended];
  if (row) row[it.actual]++;
}
for (const s of STATUSES)
  console.log(
    `  ${s.padEnd(10)}`,
    STATUSES.map((t) => `${t.slice(0, 4)}:${confusion[s][t]}`).join("  "),
  );
let agree = 0;
for (const it of items) if (it.intended === it.actual) agree++;
const agreePct = ((agree / items.length) * 100).toFixed(1);
console.log(`  intended === actual: ${agree}/${items.length} (${agreePct}%)`);
check(
  "the intended bucket holds for the majority of items",
  agree / items.length >= 0.5,
  `${agreePct}% agreement`,
);
check(
  "no item intended UNMATCHED was matched, and none intended CONFIRMED was lost",
  (confusion.UNMATCHED.CONFIRMED ?? 0) === 0 &&
    (confusion.UNMATCHED.STRONG ?? 0) === 0 &&
    (confusion.UNMATCHED.PROBABLE ?? 0) === 0 &&
    confusion.CONFIRMED.UNMATCHED === 0,
  `UNMATCHED->matched=${(confusion.UNMATCHED.CONFIRMED ?? 0) + (confusion.UNMATCHED.STRONG ?? 0) + (confusion.UNMATCHED.PROBABLE ?? 0)}, CONFIRMED->UNMATCHED=${confusion.CONFIRMED.UNMATCHED}`,
);

// ---- Summary ----------------------------------------------------------------
console.log(`\nSummary: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("ACCEPTANCE CHECK FAILED");
  process.exit(1);
}
console.log("ACCEPTANCE CHECK PASSED");
