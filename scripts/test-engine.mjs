// Engine smoke test: node scripts/test-engine.mjs
// Exercises exact/fuzzy matching, MULTIPLE, review band, NOT_FOUND and price cleaning.
import { runMatching } from "../src/lib/matching.ts";
import { cleanPrice, normalizeDescription, stripCode, detectCodeStripMode, similarity, similarityGramNumbers, numericGrams, numericGramSet, numericSiblingPenalty, stripLeadingCode, isNonItemDescription } from "../src/lib/normalize.ts";
import { analyzeSheet, detectHeaderRow, looksNumeric } from "../src/lib/parse.ts";
import { DEFAULT_SETTINGS } from "../src/lib/types.ts";

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name} ${detail}`);
  }
}

// ---- unit checks ----------------------------------------------------------
check("cleanPrice plain", cleanPrice(1250) === 1250);
check("cleanPrice currency", cleanPrice("₱1,250.50") === 1250.5, String(cleanPrice("₱1,250.50")));
check("cleanPrice PHP prefix", cleanPrice("PHP 999") === 999, String(cleanPrice("PHP 999")));
check("cleanPrice parens negative", cleanPrice("(500)") === -500, String(cleanPrice("(500)")));
check("cleanPrice euro comma", cleanPrice("1.250,50") === 1250.5, String(cleanPrice("1.250,50")));
check("cleanPrice thousands", cleanPrice("1,234,567") === 1234567, String(cleanPrice("1,234,567")));
check("cleanPrice text cell", cleanPrice(" 2 500.00 ") === 2500, String(cleanPrice(" 2 500.00 ")));
check("cleanPrice garbage", cleanPrice("N/A") === null);
check("normalize strips punct", normalizeDescription('HEX-BOLT, M8 (x40) — ZINC!') === "hex bolt m8 x40 zinc", normalizeDescription('HEX-BOLT, M8 (x40) — ZINC!'));
check("stripCode firstToken", stripCode("AB-1001 HEX BOLT M8", { mode: "firstToken" }) === "HEX BOLT M8");
check("similarity reorder high", similarity(normalizeDescription("steel pipe 1/2 inch"), normalizeDescription("1/2 Inch Steel Pipe")) >= 90, String(similarity("steel pipe 1 2 inch", "1 2 inch steel pipe")));
check("detectCodeStrip auto-first", detectCodeStripMode(["AB-1001 bolt", "AB-1002 nut", "AB-1003 washer"]).mode === "firstToken");

// ---- integration ----------------------------------------------------------
const aRows = [
  { rowNum: 2, rawName: "AB-1001 HEX BOLT M8 X 40", rawPrice: "12.50" },
  { rowNum: 3, rawName: "AB-1002 Steel Pipe 1/2 inch", rawPrice: 45 },
  { rowNum: 4, rawName: "AB-1003 Gate Valve 2 inch", rawPrice: "500" },
  { rowNum: 5, rawName: "AB-1004 Ball Valve 1 inch", rawPrice: 100 },
  { rowNum: 6, rawName: "AB-1005 Carbon Brush", rawPrice: "₱75.00" },
  { rowNum: 7, rawName: "AB-1006 Brass Hinge 3 inch", rawPrice: "1,250.50" },
  { rowNum: 8, rawName: "AB-1007 Pneumatic Cylinder 60mm", rawPrice: "PHP 9,900" },
  { rowNum: 9, rawName: "AB-1008 Safety Glove Leather", rawPrice: 210 },
  { rowNum: 10, rawName: "AB-1009 Solvent Cleaner 5L", rawPrice: "2 500,00" },
];

const bRows = [
  { rowNum: 2, rawName: "HEX BOLT M8 X 40", rawPrice: "12.50" },
  { rowNum: 3, rawName: "HEX BOLT M8 X 40 ZINC", rawPrice: "12.50" },
  { rowNum: 4, rawName: "1/2 Inch Steel Pipe", rawPrice: 45 },
  { rowNum: 5, rawName: "2 Inch Gate Valve", rawPrice: 550 },
  { rowNum: 6, rawName: "1 inch ball valve", rawPrice: 100 },
  { rowNum: 7, rawName: "1 INCH BALL VALVE", rawPrice: 105 },
  { rowNum: 8, rawName: "carbon brush", rawPrice: 70 },
  { rowNum: 9, rawName: "carbon brush", rawPrice: 75 },
  { rowNum: 10, rawName: "Stainless Hinge 3 Inch", rawPrice: "1,180" },
  { rowNum: 11, rawName: "Leather Work Gloves Pair", rawPrice: 199 },
  { rowNum: 12, rawName: "Solvent Cleaner 5L", rawPrice: "₱2,500.00" },
];

const out = runMatching(aRows, bRows, DEFAULT_SETTINGS);
const byId = new Map(out.results.map((r) => [r.aRawName, r]));
const fmt = (r) => `${r.status} method=${r.method} score=${r.score} diff=${r.difference}`;

console.log("\nResults:");
for (const r of out.results) console.log(` ${r.aRowNum} ${r.aRawName.padEnd(34)} ${fmt(r)} candidates=${r.candidates.length}`);

const s = out.stats;
console.log("\nStats:", s);

check("statuses sum to A rows", s.MATCH + s.MISMATCH + s.MULTIPLE + s.NEEDS_REVIEW + s.NOT_FOUND === aRows.length);
check("resolved code strip is firstToken", out.resolvedCodeStrip.mode === "firstToken", out.resolvedCodeStrip.mode);

const r1 = byId.get("AB-1001 HEX BOLT M8 X 40");
check("exact match accepted", r1?.status === "MATCH" && r1.method === "exact", fmt(r1 ?? {}));
const r2 = byId.get("AB-1002 Steel Pipe 1/2 inch");
check("fuzzy ≥90 auto-accepted", r2?.status === "MATCH" && r2.method === "fuzzy" && (r2.score ?? 0) >= 90, fmt(r2 ?? {}));
const r3 = byId.get("AB-1003 Gate Valve 2 inch");
check("price difference → MISMATCH", r3?.status === "MISMATCH" && r3.difference === 50, fmt(r3 ?? {}));
const r4 = byId.get("AB-1004 Ball Valve 1 inch");
check("duplicates → MULTIPLE", r4?.status === "MULTIPLE" && r4.candidates.length === 2 && r4.chosen === null, fmt(r4 ?? {}));
const r5 = byId.get("AB-1005 Carbon Brush");
check("exact duplicate B rows → MULTIPLE", r5?.status === "MULTIPLE" && r5.candidates.length === 2, fmt(r5 ?? {}));
const r6 = byId.get("AB-1006 Brass Hinge 3 inch");
check("60-89 band → NEEDS_REVIEW", r6?.status === "NEEDS_REVIEW" && (r6.score ?? 0) >= 60 && (r6.score ?? 0) < 90, fmt(r6 ?? {}));
const r7 = byId.get("AB-1007 Pneumatic Cylinder 60mm");
check("no candidates → NOT_FOUND", r7?.status === "NOT_FOUND" && r7.candidates.length === 0, fmt(r7 ?? {}));
const r8 = byId.get("AB-1008 Safety Glove Leather");
check("best-below-floor kept for review", r8?.status === "NEEDS_REVIEW" && r8.candidates.length === 1 && (r8.score ?? 0) < 60, fmt(r8 ?? {}));
const r9 = byId.get("AB-1009 Solvent Cleaner 5L");
check("euro price cleaned + fuzzy match", r9?.status === "MATCH" && r9.aPrice === 2500 && r9.bPrice === 2500, fmt(r9 ?? {}));

// ---- robustness regressions: real-world file messiness --------------------
// Dates and fractions are not prices (a date in the price column used to turn
// into a huge number and a false MISMATCH).
check("cleanPrice rejects ISO date", cleanPrice("2024-05-12") === null, String(cleanPrice("2024-05-12")));
check("cleanPrice rejects slash date", cleanPrice("12/05/2024") === null, String(cleanPrice("12/05/2024")));
check("cleanPrice rejects dot date", cleanPrice("12.05.2024") === null, String(cleanPrice("12.05.2024")));
check("cleanPrice rejects fraction", cleanPrice("5 1/2") === null, String(cleanPrice("5 1/2")));
check("cleanPrice dot-thousands (IDR/EU)", cleanPrice("1.250.500") === 1250500, String(cleanPrice("1.250.500")));
check("cleanPrice peso-prefixed dot-thousands", cleanPrice("Rp 1.250.500") === 1250500, String(cleanPrice("Rp 1.250.500")));
check("cleanPrice keeps unit-suffixed price", cleanPrice("1250.00/kg") === 1250, String(cleanPrice("1250.00/kg")));
check("cleanPrice P-prefix", cleanPrice("P 1,250.50") === 1250.5, String(cleanPrice("P 1,250.50")));
check("cleanPrice still reads plain decimal", cleanPrice("12.5") === 12.5, String(cleanPrice("12.5")));

// Full-width characters (Japanese-system exports) normalize to ASCII.
check("normalize full-width digits/letters/space", normalizeDescription("Ｎａｉｌ　２ｉｎｃｈ") === "nail 2inch", normalizeDescription("Ｎａｉｌ　２ｉｎｃｈ"));

// Item codes in trailing parentheses are recognized and stripped.
check("stripCode trailing paren code (auto)", stripCode("Common Wire Nail 2 inch (ITM-00001)", { mode: "auto" }) === "Common Wire Nail 2 inch", stripCode("Common Wire Nail 2 inch (ITM-00001)", { mode: "auto" }));
check("detectCodeStrip trailing paren codes → lastToken", detectCodeStripMode(["Common Wire Nail 2in (ITM-00001)", "Steel Pipe 1in (AB-00002)", "Gate Valve 2in (CD-00003)"]).mode === "lastToken", detectCodeStripMode(["Common Wire Nail 2in (ITM-00001)", "Steel Pipe 1in (AB-00002)", "Gate Valve 2in (CD-00003)"]).mode);
// Sizes in parentheses are NOT treated as codes.
check("detectCodeStrip ignores size parens", detectCodeStripMode(["HEX BOLT M8 (ZINC)", "HEX BOLT M8 (BLACK)", "HEX BOLT M8 (PLAIN)"]).mode === "none", detectCodeStripMode(["HEX BOLT M8 (ZINC)", "HEX BOLT M8 (BLACK)", "HEX BOLT M8 (PLAIN)"]).mode);

// Regex code-strip foot-guns stay tolerated.
check("stripCode invalid regex returns original", stripCode("AB-1 bolt", { mode: "regex", regex: "(" }) === "AB-1 bolt", stripCode("AB-1 bolt", { mode: "regex", regex: "(" }));
check("stripCode empty-matching regex returns original", stripCode("bolt", { mode: "regex", regex: ".*" }) === "bolt", stripCode("bolt", { mode: "regex", regex: ".*" }));

// Stray leading codes / vendor prefixes on File B rows.
check("stripLeadingCode itm prefix", stripLeadingCode("itm 00001 safety glove leather") === "safety glove leather", String(stripLeadingCode("itm 00001 safety glove leather")));
check("stripLeadingCode two-token code", stripLeadingCode("sku 123 heavy duty safety gloves") === "heavy duty safety gloves", String(stripLeadingCode("sku 123 heavy duty safety gloves")));
check("stripLeadingCode vendor label", stripLeadingCode("vendor nail 2 inch") === "nail 2 inch", String(stripLeadingCode("vendor nail 2 inch")));
check("stripLeadingCode keeps sizes", stripLeadingCode("2 inch ball valve") === null, String(stripLeadingCode("2 inch ball valve")));
check("stripLeadingCode keeps no. sizes", stripLeadingCode("no 10 wood screw") === null, String(stripLeadingCode("no 10 wood screw")));
check("stripLeadingCode keeps m-sizes", stripLeadingCode("m8 hex bolt") === null, String(stripLeadingCode("m8 hex bolt")));
check("stripLeadingCode keeps metric size tokens", stripLeadingCode("m8x40 hex bolt") === null, String(stripLeadingCode("m8x40 hex bolt")));
check("stripLeadingCode unsplit code token", stripLeadingCode("itm00001 safety glove leather") === "safety glove leather", String(stripLeadingCode("itm00001 safety glove leather")));

// Total/footer rows and digits-only cells are report furniture, not items.
check("footer: total", isNonItemDescription("total"));
check("footer: grand total with amount", isNonItemDescription("grand total 50000"));
check("footer: digits only", isNonItemDescription("45000"));
check("footer: page marker", isNonItemDescription("page 2"));
check("not footer: real description", !isNonItemDescription("common wire nail 2 inch"));
check("not footer: starts with total", !isNonItemDescription("total length 5m"));

// Integration: footers, stray codes on B, exact-via-alt and fuzzy-boost-via-alt.
const aRows2 = [
  { rowNum: 2, rawName: "ITM-0001 Safety Glove Leather", rawPrice: 210 },
  { rowNum: 3, rawName: "TOTAL", rawPrice: 99999 },
  { rowNum: 4, rawName: "45000", rawPrice: 1 },
  { rowNum: 5, rawName: "ITM-0002 Heavy Duty Safety Glove", rawPrice: 300 },
  { rowNum: 6, rawName: "ITM-0003 Pneumatic Cylinder 60mm", rawPrice: 500 },
];
const bRows2 = [
  { rowNum: 2, rawName: "ITM-0001 Safety Glove Leather", rawPrice: 210 }, // stray code copy
  { rowNum: 3, rawName: "SKU-123 Heavy Duty Safety Gloves", rawPrice: 300 }, // stray code + plural
  { rowNum: 4, rawName: "TOTAL", rawPrice: 0 }, // footer row in B must be ignored
];
const out2 = runMatching(aRows2, bRows2, { ...DEFAULT_SETTINGS, codeStrip: { mode: "firstToken" } });
const g2 = (i) => out2.results[i];
check("stray-code B row matches exactly", g2(0)?.status === "MATCH" && g2(0)?.method === "exact" && g2(0)?.candidates[0]?.bRowNum === 2, `${g2(0)?.status} method=${g2(0)?.method}`);
check("A total row → NOT_FOUND with note", g2(1)?.status === "NOT_FOUND" && (g2(1)?.notes[0] ?? "").includes("footer"), JSON.stringify(g2(1)?.notes));
check("A digits-only row → NOT_FOUND with note", g2(2)?.status === "NOT_FOUND" && (g2(2)?.notes[0] ?? "").includes("footer"), JSON.stringify(g2(2)?.notes));
check("stray-code B row fuzzy-boosted to auto-accept", g2(3)?.status === "MATCH" && (g2(3)?.score ?? 0) >= 90 && g2(3)?.candidates[0]?.bRowNum === 3, `${g2(3)?.status} score=${g2(3)?.score}`);
check("B footer row never becomes a candidate", g2(4)?.status === "NOT_FOUND" && g2(4)?.candidates.length === 0, `${g2(4)?.status} candidates=${g2(4)?.candidates.length}`);
check("messy run statuses sum", out2.stats.MATCH + out2.stats.MISMATCH + out2.stats.MULTIPLE + out2.stats.NEEDS_REVIEW + out2.stats.NOT_FOUND === aRows2.length);

// Default auto mode must be unaffected by the alt-key machinery when B has no codes.
const out3 = runMatching(aRows.slice(0, 9), bRows, DEFAULT_SETTINGS);
check("baseline fixture unchanged under auto mode", JSON.stringify(out3.stats) === JSON.stringify(out.stats), JSON.stringify(out3.stats));

// ---- parse regressions -----------------------------------------------------
check("looksNumeric peso string", looksNumeric("₱1,250.50"));
check("looksNumeric P-prefix", looksNumeric("P 1,250.50"));
check("looksNumeric rejects description", !looksNumeric("ITM-00001 Steel Nail 2 inch"));
check("looksNumeric rejects qty text", !looksNumeric("10 kgs"));

const titleSheet = {
  name: "S",
  rows: [
    ["ACME HARDWARE SUPPLY CO."],
    [null],
    ["DAFTAR HARGA BARANG"],
    [null],
    ["Code", "Description", "Unit Price (PHP)"],
    ["ITM-00001", "Common Wire Nail 2 inch", "12.50"],
    ["ITM-00002", "Steel Pipe 1/2 inch", "45.00"],
  ],
};
check("header row found below title/blank rows", detectHeaderRow(titleSheet.rows) === 4, String(detectHeaderRow(titleSheet.rows)));

const intlSheet = {
  name: "S",
  rows: [
    ["PT MAJU JAYA"],
    ["Kode", "Nama Barang", "Harga Satuan"],
    ["A-1", "Paku wire 2 inci", "12.500"],
    ["A-2", "Pipa besi 1/2 inci", "45.000"],
  ],
};
check("indonesian header keywords detected", detectHeaderRow(intlSheet.rows) === 1, String(detectHeaderRow(intlSheet.rows)));
const anIntl = analyzeSheet(intlSheet, 1);
check("indonesian name column picked", anIntl.mapping.nameCol === 1, JSON.stringify(anIntl.mapping));
check("indonesian price column picked", anIntl.mapping.priceCol === 2, JSON.stringify(anIntl.mapping));

const dateSheet = {
  name: "S",
  rows: [
    ["Description", "Date Encoded", "Amount Due"],
    ["Common Wire Nail 2 inch", 45000, "12.50"],
    ["Steel Pipe 1/2 inch", 45001, "45.00"],
    ["Gate Valve 2 inch", 45002, "500"],
  ],
};
const anDate = analyzeSheet(dateSheet, 0);
check("name column picked on date-sheet", anDate.mapping.nameCol === 0, JSON.stringify(anDate.mapping));
check("date/serial column not picked as price", anDate.mapping.priceCol === 2, JSON.stringify(anDate.mapping));

const accentedSheet = {
  name: "S",
  rows: [
    ["Descripción", "Precio Unitario"],
    ["Clavo común 2 pulgadas", "12.50"],
    ["Tubo de acero 1/2 pulgada", "45.00"],
  ],
};
check("accented spanish headers detected", detectHeaderRow(accentedSheet.rows) === 0, String(detectHeaderRow(accentedSheet.rows)));
const anAcc = analyzeSheet(accentedSheet, 0);
check("accented price column picked", anAcc.mapping.priceCol === 1, JSON.stringify(anAcc.mapping));

// Numeric-gram fast path must produce EXACTLY the same scores as similarity().
const parityPairs = [
  ["hex bolt m8 x 40", "hex bolt m8x40"],
  ["steel pipe 1 2 inch", "1 2 inch steel pipe"],
  ["common wire nail 2 inch", "common wire nails 2 in"],
  ["gate valve 2 inch", "gate valve 3 inch"],
  ["a", "a"],
  ["a", "ab"],
  ["", "bolt"],
  ["carbon brush", "carbon brush"],
  ["safety glove leather pair", "leather work gloves pair"],
  ["zz yy xx", "xx yy zz"],
];
let parityOk = true;
for (const [x, y] of parityPairs) {
  const nx = normalizeDescription(x);
  const ny = normalizeDescription(y);
  const ref = similarity(nx, ny);
  // The engine composes the fast Dice value with the numeric-sibling penalty.
  const fastBase = similarityGramNumbers(nx.replace(/ /g, ""), numericGramSet(nx), numericGrams(ny));
  const fast = fastBase === 100 ? 100 : Math.max(0, fastBase - numericSiblingPenalty(nx, ny));
  if (ref !== fast) {
    parityOk = false;
    console.error(`  parity mismatch: similarity(${JSON.stringify(nx)}, ${JSON.stringify(ny)}) = ${ref} vs ${fast}`);
  }
}
check("numeric-gram similarity matches reference exactly", parityOk);

// Motor-parts "family alike" siblings: numbers changing must NOT auto-match.
check(
  "sibling numbers pushed out of auto-accept band",
  similarity(normalizeDescription("ball bearing 6202 zz"), normalizeDescription("ball bearing 6203 zz")) < 90,
  String(similarity(normalizeDescription("ball bearing 6202 zz"), normalizeDescription("ball bearing 6203 zz"))),
);
check(
  "identical part number keeps 100",
  similarity(normalizeDescription("ball bearing 6202 zz"), normalizeDescription("ball bearing 6202 zz")) === 100,
);
check(
  "changed word is a rewording, not penalized as sibling",
  similarity(normalizeDescription("oil filter toyota"), normalizeDescription("oil filter toyota hilux")) >= 60,
  String(similarity(normalizeDescription("oil filter toyota"), normalizeDescription("oil filter toyota hilux"))),
);
{
  // Integration: a wrong sibling (one digit off) must not win the match.
  const sibA = [
    { rowNum: 2, rawName: "BRG-01 Ball Bearing 6202 ZZ", rawPrice: 50 },
  ];
  const sibB = [
    { rowNum: 2, rawName: "ball bearing 6203 zz", rawPrice: 60 }, // wrong sibling
    { rowNum: 3, rawName: "Ball Bearing 6202 ZZ", rawPrice: 50 }, // true match
  ];
  const sibOut = runMatching(sibA, sibB, DEFAULT_SETTINGS);
  const sibRes = sibOut.results[0];
  check(
    "sibling integration: true part matched, not the digit-off sibling",
    sibRes.status === "MATCH" && sibRes.chosen?.bRowNum === 3,
    JSON.stringify({ status: sibRes.status, b: sibRes.chosen?.bRowNum }),
  );
}

// Smoke: empty inputs and every code-strip mode run without throwing.
const empty = runMatching([], [], DEFAULT_SETTINGS);
check("empty run returns zeroed stats", empty.stats.total === 0 && empty.results.length === 0);
const modes = ["none", "firstToken", "lastToken", "regex"];
let modesOk = true;
for (const m of modes) {
  const cfg = m === "regex" ? { mode: m, regex: "^ITM-\\d+\\s+" } : { mode: m };
  const o = runMatching(aRows.slice(0, 9), bRows, { ...DEFAULT_SETTINGS, codeStrip: cfg });
  if (o.stats.MATCH + o.stats.MISMATCH + o.stats.MULTIPLE + o.stats.NEEDS_REVIEW + o.stats.NOT_FOUND !== 9) modesOk = false;
}
check("all code-strip modes complete", modesOk);

// Percentage price tolerance: allowed gap = tolerance% of the A price.
{
  const tolRows = [
    { rowNum: 2, rawName: "TOL-01 Widget Blue", rawPrice: 100 },
    { rowNum: 3, rawName: "TOL-02 Widget Red", rawPrice: 200 },
  ];
  const tolB = [
    { rowNum: 2, rawName: "widget blue", rawPrice: 104 }, // 4% gap
    { rowNum: 3, rawName: "widget red", rawPrice: 212 }, // 6% gap
  ];
  const tol5 = runMatching(tolRows, tolB, { ...DEFAULT_SETTINGS, priceTolerance: 5 });
  const blue = tol5.results.find((r) => r.aRowNum === 2);
  const red = tol5.results.find((r) => r.aRowNum === 3);
  check("tolerance 5% accepts a 4% gap as MATCH", blue?.status === "MATCH", String(blue?.status));
  check("tolerance 5% rejects a 6% gap as MISMATCH", red?.status === "MISMATCH", String(red?.status));
  const tol0 = runMatching(tolRows, tolB, { ...DEFAULT_SETTINGS, priceTolerance: 0 });
  const blue0 = tol0.results.find((r) => r.aRowNum === 2);
  check("tolerance 0% keeps exact-only matching", blue0?.status === "MISMATCH", String(blue0?.status));
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll checks passed.");
