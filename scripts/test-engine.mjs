// Engine smoke test: node scripts/test-engine.mjs
// Exercises the three-layer identity model: part-number extraction and Stage-0
// code matching, exact-description STRONG, fuzzy-only PROBABLE (never
// auto-accepted), description CONFLICT on shared codes, UNMATCHED, dimension
// normalization, valuation evidence, and price cleaning.
import { runMatching } from "../src/lib/matching.ts";
import {
  cleanPrice,
  normalizeDescription,
  stripCode,
  detectCodeStripMode,
  similarity,
  similarityGramNumbers,
  numericGrams,
  numericGramSet,
  numericSiblingPenalty,
  stripLeadingCode,
  isNonItemDescription,
} from "../src/lib/normalize.ts";
import {
  extractIdentity,
  extractCodesFromText,
  extractDimensions,
  normalizePartCode,
  wordOverlap,
} from "../src/lib/identity.ts";
import { computeValuation, valuationFlag } from "../src/lib/analysis.ts";
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
check("normalize strips punct", normalizeDescription('HEX-BOLT, M8 (x40) — ZINC!') === "hex bolt m8x40 zinc", normalizeDescription('HEX-BOLT, M8 (x40) — ZINC!'));
check("stripCode firstToken", stripCode("AB-1001 HEX BOLT M8", { mode: "firstToken" }) === "HEX BOLT M8");
check("similarity reorder high", similarity(normalizeDescription("steel pipe 1/2 inch"), normalizeDescription("1/2 Inch Steel Pipe")) >= 90, String(similarity("steel pipe 1 2 inch", "1 2 inch steel pipe")));
check("detectCodeStrip auto-first", detectCodeStripMode(["AB-1001 bolt", "AB-1002 nut", "AB-1003 washer"]).mode === "firstToken");

// Domain abbreviations standardize (distinctions like left/right are preserved).
check("abbrev frt→front", normalizeDescription("FRT Brake Pad") === "front brake pad", normalizeDescription("FRT Brake Pad"));
check("abbrev rr→rear", normalizeDescription("Shock Absorber RR") === "shock absorber rear", normalizeDescription("Shock Absorber RR"));
check("abbrev assy→assembly", normalizeDescription("Bumper Assy, Chrome") === "bumper assembly chrome", normalizeDescription("Bumper Assy, Chrome"));
check("abbrev lh/rh stay distinct", normalizeDescription("Mirror LH") !== normalizeDescription("Mirror RH"), `${normalizeDescription("Mirror LH")} vs ${normalizeDescription("Mirror RH")}`);
check("abbrev hi-lux→hilux", normalizeDescription("Fuel Filter Hi-Lux") === "fuel filter hilux", normalizeDescription("Fuel Filter Hi-Lux"));

// Dimension runs join regardless of separator ("27x40x6" / "27 × 40 × 6" / "27-40-6").
check("dims x-form", normalizeDescription("OIL SEAL 27x40x6") === "oil seal 27x40x6", normalizeDescription("OIL SEAL 27x40x6"));
check("dims ×-spaced form", normalizeDescription("Oil Seal 27 × 40 × 6") === "oil seal 27x40x6", normalizeDescription("Oil Seal 27 × 40 × 6"));
check("dims hyphen form", normalizeDescription("OIL SEAL, 27-40-6") === "oil seal 27x40x6", normalizeDescription("OIL SEAL, 27-40-6"));
check("dims metric size joins", normalizeDescription("Hex Bolt M8 X 40") === "hex bolt m8x40", normalizeDescription("Hex Bolt M8 X 40"));

// Part/model code extraction.
check("partCode joined", normalizePartCode("A-1022") === "A1022", String(normalizePartCode("A-1022")));
check("partCode spaced", normalizePartCode("a 58460") === "A58460", String(normalizePartCode("a 58460")));
check("partCode rejects no-digit", normalizePartCode("ABCD") === null);
check("partCode rejects tiny", normalizePartCode("A-1") === null);
check("codeFromText letter-prefix", extractCodesFromText("AIR FILTER, A-1022 SAKURA").includes("A1022"), JSON.stringify(extractCodesFromText("AIR FILTER, A-1022 SAKURA")));
check("codeFromText hyphen family", extractCodesFromText("BALL JOINT KBJ-1202").includes("KBJ1202"), JSON.stringify(extractCodesFromText("BALL JOINT KBJ-1202")));
check("codeFromText toyota style", extractCodesFromText("AIR FILTER 23390-0L070").includes("233900L070"), JSON.stringify(extractCodesFromText("AIR FILTER 23390-0L070")));
check("codeFromText digit-digit", extractCodesFromText("AIR BRAKE BOOSTER, 208-54109").includes("20854109"), JSON.stringify(extractCodesFromText("AIR BRAKE BOOSTER, 208-54109")));
check("codeFromText rejects dates", extractCodesFromText("Purchase 2024-0512").length === 0, JSON.stringify(extractCodesFromText("Purchase 2024-0512")));
check("codeFromText rejects sizes", extractCodesFromText("Hex Bolt M8 x 40 5L").length === 0, JSON.stringify(extractCodesFromText("Hex Bolt M8 x 40 5L")));
check("codeFromText rejects pack phrases (no phantom BOX100)", !extractCodesFromText("Common Wire Nail 2 inch per box 100 pcs").some((c) => c.includes("BOX")), JSON.stringify(extractCodesFromText("Common Wire Nail 2 inch per box 100 pcs")));
check("codeFromText rejects pack phrases (no phantom CTN250)", !extractCodesFromText("Cement per carton 250 kg").some((c) => c.includes("CTN")), JSON.stringify(extractCodesFromText("Cement per carton 250 kg")));
check("codeFromText accepts 6-digit toyota prefix", extractCodesFromText("AIR FILTER 402196-0L09").includes("4021960L09"), JSON.stringify(extractCodesFromText("AIR FILTER 402196-0L09")));
check("codeFromText keeps alpha-prefixed year-shaped tail", extractCodesFromText("BALL JOINT KBJ-1912").includes("KBJ1912"), JSON.stringify(extractCodesFromText("BALL JOINT KBJ-1912")));
check("dims extraction", extractDimensions("OIL SEAL 27x40x6").includes("27x40x6"), JSON.stringify(extractDimensions("OIL SEAL 27x40x6")));
check("identity words drop code tokens", extractIdentity("AIR FILTER, A-1022 SAKURA").words.join("|") === "air|filter|sakura", JSON.stringify(extractIdentity("AIR FILTER, A-1022 SAKURA").words));
check("identity codes from column", extractIdentity("Air Filter", "A-1022").codes.join(",") === "A1022", JSON.stringify(extractIdentity("Air Filter", "A-1022").codes));
check("wordOverlap identical", wordOverlap(["air", "filter"], ["air", "filter"]) === 1);
check("wordOverlap disjoint", wordOverlap(["air", "filter"], ["fuel", "filter", "hilux"]) < 0.4, String(wordOverlap(["air", "filter"], ["fuel", "filter", "hilux"])));

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

const statusSum = s.CONFIRMED + s.STRONG + s.PROBABLE + s.CONFLICT + s.UNMATCHED;
check("statuses sum to A rows", statusSum === aRows.length, String(statusSum));
check("resolved code strip is firstToken", out.resolvedCodeStrip.mode === "firstToken", out.resolvedCodeStrip.mode);

const r1 = byId.get("AB-1001 HEX BOLT M8 X 40");
check("exact description → STRONG", r1?.status === "STRONG" && r1.method === "exact", fmt(r1 ?? {}));
const r2 = byId.get("AB-1002 Steel Pipe 1/2 inch");
check("fuzzy reorder → PROBABLE (never auto-accepted)", r2?.status === "PROBABLE" && r2.method === "fuzzy" && (r2.score ?? 0) >= 90, fmt(r2 ?? {}));
const r3 = byId.get("AB-1003 Gate Valve 2 inch");
check("price difference is evidence, not identity", r3?.status === "PROBABLE" && r3.difference === 50, fmt(r3 ?? {}));
const r4 = byId.get("AB-1004 Ball Valve 1 inch");
check("reordered duplicates both collected, best first", r4?.status === "PROBABLE" && r4.candidates.length === 2 && r4.chosen?.bRowNum === 6, fmt(r4 ?? {}));
const r5 = byId.get("AB-1005 Carbon Brush");
check("exact duplicate B rows → STRONG with 2 records", r5?.status === "STRONG" && r5.candidates.length === 2, fmt(r5 ?? {}));
const r6 = byId.get("AB-1006 Brass Hinge 3 inch");
check("fuzzy band → PROBABLE", r6?.status === "PROBABLE" && (r6.score ?? 0) >= 60 && (r6.score ?? 0) < 100, fmt(r6 ?? {}));
const r7 = byId.get("AB-1007 Pneumatic Cylinder 60mm");
check("no candidates → UNMATCHED", r7?.status === "UNMATCHED" && r7.candidates.length === 0, fmt(r7 ?? {}));
const r8 = byId.get("AB-1008 Safety Glove Leather");
check("below review floor → UNMATCHED (no silent near-miss)", r8?.status === "UNMATCHED" && r8.candidates.length === 0, fmt(r8 ?? {}));
const r9 = byId.get("AB-1009 Solvent Cleaner 5L");
check("euro price cleaned + exact match", r9?.status === "STRONG" && r9.aPrice === 2500 && r9.bPrice === 2500, fmt(r9 ?? {}));

// ---- identification model: part numbers -----------------------------------
{
  // The expert's A1022 case: nomenclature differs, the code carries identity.
  const a = [{ rowNum: 2, rawName: "AIR FILTER, A-1022 SAKURA", rawPrice: 540 }];
  const b = [{ rowNum: 2, rawName: "Air Filter Adventure Diesel", rawPrice: 350, rawCode: "A-1022" }];
  const o = runMatching(a, b, DEFAULT_SETTINGS);
  const r = o.results[0];
  check("code match → CONFIRMED despite different wording", r.status === "CONFIRMED" && r.method === "code" && r.aCodes.includes("A1022"), JSON.stringify({ status: r.status, method: r.method, codes: r.aCodes }));
  check("code match collects the record as reference", r.chosen?.bRowNum === 2 && r.difference === -190, fmt(r));
  check("CONFIRMED survives any price gap", r.status === "CONFIRMED", r.status);
}

{
  // The expert's 23390-0L070 case: code matches, product type conflicts.
  const a = [{ rowNum: 2, rawName: "AIR FILTER 23390-0L070", rawPrice: 480 }];
  const b = [{ rowNum: 2, rawName: "Fuel Filter, Hi-Lux/Innova '16", rawPrice: 620, rawCode: "23390-0L070" }];
  const o = runMatching(a, b, DEFAULT_SETTINGS);
  const r = o.results[0];
  check("code match + description conflict → CONFLICT", r.status === "CONFLICT" && r.chosen === null, JSON.stringify({ status: r.status, chosen: r.chosen?.bRowNum }));
  check("conflict notes name the offending row", (r.notes[0] ?? "").includes("B2"), JSON.stringify(r.notes));
}

{
  // Mixed: one compatible code record + one conflicting → CONFIRMED with a flag.
  // The costing file carries the code in its structured Part No. column (that
  // is what makes the match strong identity evidence).
  const a = [{ rowNum: 2, rawName: "BALL JOINT KBJ-1202", rawPrice: 300 }];
  const b = [
    { rowNum: 2, rawName: "Ball Joint Lower KBJ-1202", rawPrice: 280, rawCode: "KBJ-1202" },
    { rowNum: 3, rawName: "Tie Rod End KBJ-1202", rawPrice: 260, rawCode: "KBJ-1202" },
  ];
  const o = runMatching(a, b, DEFAULT_SETTINGS);
  const r = o.results[0];
  check("mixed code evidence → CONFIRMED with conflict note", r.status === "CONFIRMED" && r.candidates.some((c) => c.bRowNum === 2) === true && r.notes.some((n) => n.includes("conflict")), JSON.stringify({ status: r.status, notes: r.notes }));
}

{
  // Weak codes: the same code embedded in BOTH descriptions (no Part No.
  // column anywhere) must NOT confirm identity on its own — "Nail 100mm"
  // parses as NAIL100MM on both sides of the comparison.
  const a = [{ rowNum: 2, rawName: "Common Wire Nail 100mm", rawPrice: 50 }];
  const b = [{ rowNum: 2, rawName: "Wire Nail 100mm", rawPrice: 55 }];
  const o = runMatching(a, b, DEFAULT_SETTINGS);
  check("text-only code match never confirms", o.results[0].status === "PROBABLE" && o.results[0].candidates[0]?.matchedCode !== null, `${o.results[0].status} matchedCode=${o.results[0].candidates[0]?.matchedCode}`);
  // …but it does rank the candidate and surface the code it matched on.
  check("weak code match still recorded on the candidate", o.results[0].candidates[0]?.matchedCode != null, String(o.results[0].candidates[0]?.matchedCode));
}

{
  // Zero-price costing records: identity evidence, excluded from valuation.
  const a = [{ rowNum: 2, rawName: "ROTOR DISC, PRD-26051", rawPrice: 900 }];
  const b = [
    { rowNum: 2, rawName: "Rotor Disc PRD-26051", rawPrice: 0, rawCode: "PRD-26051" },
    { rowNum: 3, rawName: "Brake Rotor PRD-26051 Front", rawPrice: 850, rawCode: "PRD-26051" },
    { rowNum: 4, rawName: "Brake Rotor PRD-26051 Rear", rawPrice: 920, rawCode: "PRD-26051" },
  ];
  const o = runMatching(a, b, DEFAULT_SETTINGS);
  const r = o.results[0];
  check("zero-price records still confirm identity", r.status === "CONFIRMED" && r.candidates.length === 3, `${r.status} candidates=${r.candidates.length}`);
  const val = computeValuation(o.results, {}).get(0);
  check("valuation counts records but excludes ₱0 from the range", val.count === 2 && val.zeroCount === 1 && val.lowest === 850 && val.highest === 920, JSON.stringify(val));
  const wavg = val.weightedAvg;
  check("weighted avg = simple mean without qty", wavg === 885, String(wavg));
  check("flag: claimed above range → 'above'", valuationFlag(val, 950, 0) === "above", valuationFlag(val, 950, 0));
  check("flag: within allowance explains ACV", valuationFlag(val, 950, 10) === "above-allowed", valuationFlag(val, 950, 10));
  check("flag: in range", valuationFlag(val, 880, 0) === "in-range");
  check("flag: below range", valuationFlag(val, 800, 0) === "below");
  check("flag: unpriced when no usable records", valuationFlag(computeValuation([{ id: 9, candidates: [{ bRowNum: 1, rawName: "x", cleaned: "x", rawPrice: 0, price: 0, similarity: 100 }] }], {}).get(9), 500, 0) === "unpriced");
}

{
  // Qty-weighted average when quantities exist.
  const a = [{ rowNum: 2, rawName: "AIR FILTER, A-1022 SAKURA", rawPrice: 540 }];
  const b = [
    { rowNum: 2, rawName: "Air Filter A-1022", rawPrice: 350, rawCode: "A1022" },
    { rowNum: 3, rawName: "Air Filter A1022 bulk", rawPrice: 320, rawCode: "A1022" },
  ];
  const o = runMatching(a, b, DEFAULT_SETTINGS);
  const val = computeValuation(o.results, { 2: 2, 3: 8 }).get(0);
  check("qty-weighted average", val.weightedAvg === 326, String(val.weightedAvg));
}

{
  // Dimensions: same family, different size, no code → stays PROBABLE.
  const a = [{ rowNum: 2, rawName: "OIL SEAL 27x40x6", rawPrice: 90 }];
  const b = [{ rowNum: 2, rawName: "OIL SEAL, 27-40-6", rawPrice: 88 }];
  const o = runMatching(a, b, DEFAULT_SETTINGS);
  check("dim variants normalize to exact → STRONG", o.results[0].status === "STRONG", o.results[0].status);
  const a2 = [{ rowNum: 2, rawName: "OIL SEAL 30x45x7", rawPrice: 90 }];
  const o2 = runMatching(a2, b, DEFAULT_SETTINGS);
  // A different size is a DIFFERENT item — the numeric-sibling penalty keeps
  // it far below the review floor instead of silently matching the 27x40x6.
  check("different dims → UNMATCHED (different item, not auto-matched)", o2.results[0].status === "UNMATCHED", o2.results[0].status);
}

// ---- robustness regressions: real-world file messiness --------------------
check("cleanPrice rejects ISO date", cleanPrice("2024-05-12") === null, String(cleanPrice("2024-05-12")));
check("cleanPrice rejects slash date", cleanPrice("12/05/2024") === null, String(cleanPrice("12/05/2024")));
check("cleanPrice rejects dot date", cleanPrice("12.05.2024") === null, String(cleanPrice("12.05.2024")));
check("cleanPrice rejects fraction", cleanPrice("5 1/2") === null, String(cleanPrice("5 1/2")));
check("cleanPrice dot-thousands (IDR/EU)", cleanPrice("1.250.500") === 1250500, String(cleanPrice("1.250.500")));
check("cleanPrice peso-prefixed dot-thousands", cleanPrice("Rp 1.250.500") === 1250500, String(cleanPrice("Rp 1.250.500")));
check("cleanPrice keeps unit-suffixed price", cleanPrice("1250.00/kg") === 1250, String(cleanPrice("1250.00/kg")));
check("cleanPrice P-prefix", cleanPrice("P 1,250.50") === 1250.5, String(cleanPrice("P 1,250.50")));
check("cleanPrice still reads plain decimal", cleanPrice("12.5") === 12.5, String(cleanPrice("12.5")));

check("normalize full-width digits/letters/space", normalizeDescription("Ｎａｉｌ　２ｉｎｃｈ") === "nail 2inch", normalizeDescription("Ｎａｉｌ　２ｉｎｃｈ"));

check("stripCode trailing paren code (auto)", stripCode("Common Wire Nail 2 inch (ITM-00001)", { mode: "auto" }) === "Common Wire Nail 2 inch", stripCode("Common Wire Nail 2 inch (ITM-00001)", { mode: "auto" }));
check("detectCodeStrip trailing paren codes → lastToken", detectCodeStripMode(["Common Wire Nail 2in (ITM-00001)", "Steel Pipe 1in (AB-00002)", "Gate Valve 2in (CD-00003)"]).mode === "lastToken", detectCodeStripMode(["Common Wire Nail 2in (ITM-00001)", "Steel Pipe 1in (AB-00002)", "Gate Valve 2in (CD-00003)"]).mode);
check("detectCodeStrip ignores size parens", detectCodeStripMode(["HEX BOLT M8 (ZINC)", "HEX BOLT M8 (BLACK)", "HEX BOLT M8 (PLAIN)"]).mode === "none", detectCodeStripMode(["HEX BOLT M8 (ZINC)", "HEX BOLT M8 (BLACK)", "HEX BOLT M8 (PLAIN)"]).mode);

check("stripCode invalid regex returns original", stripCode("AB-1 bolt", { mode: "regex", regex: "(" }) === "AB-1 bolt", stripCode("AB-1 bolt", { mode: "regex", regex: "(" }));
check("stripCode empty-matching regex returns original", stripCode("bolt", { mode: "regex", regex: ".*" }) === "bolt", stripCode("bolt", { mode: "regex", regex: ".*" }));

check("stripLeadingCode itm prefix", stripLeadingCode("itm 00001 safety glove leather") === "safety glove leather", String(stripLeadingCode("itm 00001 safety glove leather")));
check("stripLeadingCode two-token code", stripLeadingCode("sku 123 heavy duty safety gloves") === "heavy duty safety gloves", String(stripLeadingCode("sku 123 heavy duty safety gloves")));
check("stripLeadingCode vendor label", stripLeadingCode("vendor nail 2 inch") === "nail 2 inch", String(stripLeadingCode("vendor nail 2 inch")));
check("stripLeadingCode keeps sizes", stripLeadingCode("2 inch ball valve") === null, String(stripLeadingCode("2 inch ball valve")));
check("stripLeadingCode keeps no. sizes", stripLeadingCode("no 10 wood screw") === null, String(stripLeadingCode("no 10 wood screw")));
check("stripLeadingCode keeps m-sizes", stripLeadingCode("m8 hex bolt") === null, String(stripLeadingCode("m8 hex bolt")));
check("stripLeadingCode keeps metric size tokens", stripLeadingCode("m8x40 hex bolt") === null, String(stripLeadingCode("m8x40 hex bolt")));
check("stripLeadingCode unsplit code token", stripLeadingCode("itm00001 safety glove leather") === "safety glove leather", String(stripLeadingCode("itm00001 safety glove leather")));

check("footer: total", isNonItemDescription("total"));
check("footer: grand total with amount", isNonItemDescription("grand total 50000"));
check("footer: digits only", isNonItemDescription("45000"));
check("footer: page marker", isNonItemDescription("page 2"));
check("not footer: real description", !isNonItemDescription("common wire nail 2 inch"));
check("not footer: starts with total", !isNonItemDescription("total length 5m"));

// Integration: footers, stray codes on B, exact-via-alt and code identity.
const aRows2 = [
  { rowNum: 2, rawName: "ITM-0001 Safety Glove Leather", rawPrice: 210 },
  { rowNum: 3, rawName: "TOTAL", rawPrice: 99999 },
  { rowNum: 4, rawName: "45000", rawPrice: 1 },
  { rowNum: 5, rawName: "ITM-0002 Heavy Duty Safety Glove", rawPrice: 300 },
  { rowNum: 6, rawName: "ITM-0003 Pneumatic Cylinder 60mm", rawPrice: 500 },
];
const bRows2 = [
  { rowNum: 2, rawName: "ITM-0001 Safety Glove Leather", rawPrice: 210, rawCode: "ITM-0001" }, // Part No. column copy
  { rowNum: 3, rawName: "SKU-123 Heavy Duty Safety Gloves", rawPrice: 300 }, // stray code + plural
  { rowNum: 4, rawName: "TOTAL", rawPrice: 0 }, // footer row in B must be ignored
];
const out2 = runMatching(aRows2, bRows2, { ...DEFAULT_SETTINGS, codeStrip: { mode: "firstToken" } });
const g2 = (i) => out2.results[i];
check("stray-code B row: shared code → CONFIRMED", g2(0)?.status === "CONFIRMED" && g2(0)?.candidates[0]?.bRowNum === 2, `${g2(0)?.status}`);
check("A total row → UNMATCHED with note", g2(1)?.status === "UNMATCHED" && (g2(1)?.notes[0] ?? "").includes("footer"), JSON.stringify(g2(1)?.notes));
check("A digits-only row → UNMATCHED with note", g2(2)?.status === "UNMATCHED" && (g2(2)?.notes[0] ?? "").includes("footer"), JSON.stringify(g2(2)?.notes));
check("alt-key fuzzy → PROBABLE with the stray-code row found", g2(3)?.status === "PROBABLE" && g2(3)?.candidates[0]?.bRowNum === 3, `${g2(3)?.status} top=${g2(3)?.candidates[0]?.bRowNum}`);
check("B footer row never becomes a candidate", g2(4)?.status === "UNMATCHED" && g2(4)?.candidates.length === 0, `${g2(4)?.status} candidates=${g2(4)?.candidates.length}`);
check("messy run statuses sum", out2.stats.CONFIRMED + out2.stats.STRONG + out2.stats.PROBABLE + out2.stats.CONFLICT + out2.stats.UNMATCHED === aRows2.length);

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

const anTitle = analyzeSheet(titleSheet, 4);
check("code column detected (Code header)", anTitle.mapping.codeCol === 0, JSON.stringify(anTitle.mapping));
check("name column picked beside code column", anTitle.mapping.nameCol === 1, JSON.stringify(anTitle.mapping));
check("price column picked beside code column", anTitle.mapping.priceCol === 2, JSON.stringify(anTitle.mapping));

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
  const fastBase = similarityGramNumbers(nx.replace(/ /g, ""), numericGramSet(nx), numericGrams(ny));
  const fast = fastBase === 100 ? 100 : Math.max(0, fastBase - numericSiblingPenalty(nx, ny));
  if (ref !== fast) {
    parityOk = false;
    console.error(`  parity mismatch: similarity(${JSON.stringify(nx)}, ${JSON.stringify(ny)}) = ${ref} vs ${fast}`);
  }
}
check("numeric-gram similarity matches reference exactly", parityOk);

// Motor-parts "family alike" siblings: numbers changing must NOT score as identical.
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
    sibRes.status === "STRONG" && sibRes.chosen?.bRowNum === 3,
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
  const sum = o.stats.CONFIRMED + o.stats.STRONG + o.stats.PROBABLE + o.stats.CONFLICT + o.stats.UNMATCHED;
  if (sum !== 9) modesOk = false;
}
check("all code-strip modes complete", modesOk);

// Price tolerance is informational now: identity never flips with the setting.
{
  const tolRows = [{ rowNum: 2, rawName: "TOL-01 Widget Blue", rawPrice: 100 }];
  const tolB = [{ rowNum: 2, rawName: "widget blue", rawPrice: 104 }];
  const tol5 = runMatching(tolRows, tolB, { ...DEFAULT_SETTINGS, priceTolerance: 5 });
  const tol0 = runMatching(tolRows, tolB, { ...DEFAULT_SETTINGS, priceTolerance: 0 });
  check("tolerance does not change identity", tol5.results[0].status === tol0.results[0].status && tol5.results[0].status === "STRONG", `${tol5.results[0].status}/${tol0.results[0].status}`);
  check("difference recorded regardless", tol0.results[0].difference === 4, String(tol0.results[0].difference));
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll checks passed.");
