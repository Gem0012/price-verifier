// Dummy data generator: node scripts/make-dummy-data.mjs
// Builds File A (masterlist, 5,000 coded rows) and File B (to verify, ~20,000
// description-only rows), validates them through the real matching engine, and
// writes both .xlsx files plus an answer key used by acceptance spot-checks.
import * as XLSX from "xlsx";
import { runMatching } from "../src/lib/matching.ts";
import {
  cleanPrice,
  detectCodeStripMode,
  normalizeDescription,
  similarity,
} from "../src/lib/normalize.ts";
import { analyzeSheet } from "../src/lib/parse.ts";
import { DEFAULT_SETTINGS } from "../src/lib/types.ts";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = "C:/Files-2.1";
const A_TARGET = 5000;
const B_TARGET = 20000;
const UNMATCHED_TARGET = 120;
const CONFIRMED_TARGET = 400; // items with an embedded part code + matching B Part No.
const CONFLICT_TARGET = 120; // code matches a costing row describing a different product
const DUP_TARGET = 160; // items with a second B record (nothing is locked)
const SEED = 20260929;

// ---------------------------------------------------------------------------
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
const rng = mulberry32(SEED);
const rand = (n) => Math.floor(rng() * n);
const pick = (arr) => arr[rand(arr.length)];
const chance = (p) => rng() < p;
const round2 = (n) => Math.round(n * 100) / 100;
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const tokensOf = (desc) => desc.split(" ").filter(Boolean);

// ---------------------------------------------------------------------------
// Catalog vocabulary. Regular families produce both masterlist items and
// "decoy" B rows (similar but different SKUs). Exclusive families exist ONLY
// in File A so those items end up NOT_FOUND (zero token overlap with B).
const REGULAR = [
  {
    category: "Nails",
    kinds: ["Common Wire Nail", "Concrete Nail", "Roofing Nail", "Finishing Nail", "Twist Nail", "Umbrella Nail", "Boat Nail"],
    sizes: ["1 inch", "2 inch", "3 inch", "4 inch", "50mm", "75mm", "100mm"],
    finishes: ["Galvanized", "Plain", "Blue Steel", "Bright", "Vinyl Coated"],
    brands: ["MSTC", "Elephant", "Atlas", "Titan", "Olympic", "Sunrise", "Kingwood"],
    packs: ["per kg", "per box 100 pcs", "per box 500 pcs", "per pc", "per box 5 kg"],
    price: [12, 160],
  },
  {
    category: "Screws",
    kinds: ["Self Drilling Screw", "Wood Screw", "Drywall Screw", "Machine Screw", "Deck Screw", "Roofing Screw", "Furniture Screw"],
    sizes: ["#6 x 1 inch", "#8 x 1.5 inch", "#8 x 2 inch", "#10 x 2 inch", "#10 x 3 inch", "#12 x 4 inch", "#14 x 5 inch"],
    finishes: ["Zinc Plated", "Black Phosphate", "Stainless", "Yellow Zinc", "Plain"],
    brands: ["Fastpro", "Gripwell", "Screwmart", "Torqline", "Buildfast", "Hexon", "Driva"],
    packs: ["per box 200 pcs", "per box 500 pcs", "per box 1000 pcs", "per kg", "per box 100 pcs"],
    price: [30, 260],
  },
  {
    category: "Bolts & Nuts",
    kinds: ["Hex Bolt", "Carriage Bolt", "Anchor Bolt", "Trojan Bolt", "Hex Nut", "Wing Bolt", "Stud Bolt"],
    sizes: ["M8 x 40mm", "M8 x 60mm", "M10 x 50mm", "M10 x 75mm", "M12 x 60mm", "M12 x 100mm", "M16 x 120mm"],
    finishes: ["Zinc Plated", "Galvanized", "Black", "Plain", "Stainless"],
    brands: ["Nutbolt Co", "Ironhold", "Threadex", "Boltmaster", "Steelgrip", "Unifast", "Ferrotek"],
    packs: ["per pc", "per box 50 pcs", "per box 100 pcs", "per kg", "per pack 20 pcs"],
    price: [8, 120],
  },
  {
    category: "Washers",
    kinds: ["Flat Washer", "Spring Washer", "Fender Washer", "Rubber Washer", "Lock Washer", "Nylon Washer", "Cup Washer"],
    sizes: ["M6", "M8", "M10", "M12", "M16", "1/2 inch", "5/8 inch"],
    finishes: ["Zinc Plated", "Galvanized", "Black", "Stainless", "Plain"],
    brands: ["Ironhold", "Washertech", "Flatco", "Ringfast", "Sealpro", "Gasketpro", "Ringmaster"],
    packs: ["per box 100 pcs", "per kg", "per pack 500 pcs", "per pc", "per box 1000 pcs"],
    price: [3, 45],
  },
  {
    category: "Hinges",
    kinds: ["Butt Hinge", "Gate Hinge", "Cabinet Hinge", "Piano Hinge", "Spring Hinge", "Concealed Hinge", "Strap Hinge"],
    sizes: ["2 inch", "3 inch", "4 inch", "5 inch", "6 inch", "75mm", "100mm"],
    finishes: ["Brass", "Stainless", "Black Powder Coat", "Zinc", "Antique Bronze"],
    brands: ["Doorfit", "Hingemax", "Swingwell", "Bronzecraft", "Metalux", "Doorpro", "Pivotking"],
    packs: ["per pair", "per pc", "per box 20 pairs", "per dozen", "per box 50 pairs"],
    price: [25, 240],
  },
  {
    category: "Paints",
    kinds: ["Latex Paint", "Enamel Paint", "Epoxy Primer", "Acrylic Sealer", "Wood Stain", "Roof Paint", "Rust Converter"],
    sizes: ["1 liter", "4 liter", "1 gallon", "5 gallon", "500ml", "16 liter", "20 liter"],
    finishes: ["Gloss White", "Matte White", "Semi Gloss Beige", "Flat Black", "Satin Finish"],
    brands: ["Colorfast", "Raincoat", "Primetone", "Duplachrome", "Paintwell", "Titancoat", "Chrometone"],
    packs: ["per can", "per pail", "per gallon", "per liter", "per drum"],
    price: [120, 1600],
  },
  {
    category: "Brushes & Rollers",
    kinds: ["Paint Brush", "Paint Roller", "Wire Brush", "Chip Brush", "Foam Brush", "Textured Roller", "Corner Roller"],
    sizes: ["1 inch", "2 inch", "3 inch", "4 inch", "180mm", "230mm", "75mm"],
    finishes: ["Nylon Bristle", "Plastic Handle", "Wooden Handle", "Steel Wire", "Foam Pad"],
    brands: ["Brushwell", "Coatpro", "Fineline", "Strokeex", "Brushmate", "Bristleco", "Rollico"],
    packs: ["per pc", "per dozen", "per pack 6 pcs", "per box 24 pcs", "per pack 3 pcs"],
    price: [18, 210],
  },
  {
    category: "Cement & Admixtures",
    kinds: ["Portland Cement", "Masonry Cement", "Tile Adhesive", "Grout", "Waterproofing Compound", "Plaster", "Concrete Patch"],
    sizes: ["40 kg bag", "25 kg bag", "10 kg bag", "1 kg pouch", "5 kg pail", "20 kg bag", "500g pouch"],
    finishes: ["Type 1", "Type 2", "Ordinary", "High Early", "White"],
    brands: ["Unioheat", "Rhinohead", "Everstrong", "Rockbind", "Solidmix", "Cempro", "Mixwell"],
    packs: ["per bag", "per sack", "per pouch", "per pallet 40 bags", "per pail"],
    price: [35, 480],
  },
  {
    category: "Pipe Fittings",
    kinds: ["Elbow 90", "Elbow 45", "Tee Coupling", "Union", "Adapter", "Pipe Cap", "Reducer"],
    sizes: ["1/2 inch", "3/4 inch", "1 inch", "1.25 inch", "2 inch", "3 inch", "4 inch"],
    finishes: ["Schedule 40", "Schedule 80", "Standard", "PVC Gray", "PVC White"],
    brands: ["Pipefit", "Flowwell", "PVC Pro", "Jointex", "Aquaflow", "Tubemax", "Fittingpro"],
    packs: ["per pc", "per pack 10 pcs", "per box 25 pcs", "per dozen", "per pack 5 pcs"],
    price: [10, 180],
  },
  {
    category: "Electrical Wires",
    kinds: ["THHN Wire", "TW Wire", "Flat Cord", "Flexible Wire", "Service Entrance Wire", "THW Wire", "Speaker Wire"],
    sizes: ["2.0mm", "3.5mm", "5.5mm", "8.0mm", "14awg", "12awg", "10awg"],
    finishes: ["Red", "Black", "Blue", "White", "Green"],
    brands: ["Philtex", "Amerplex", "Cordmax", "Wirezta", "Voltline", "Supracord", "Electrix"],
    packs: ["per 100m roll", "per 50m roll", "per meter cut", "per roll", "per 150m roll"],
    price: [450, 3600],
  },
  {
    category: "Tapes",
    kinds: ["Electrical Tape", "Duct Tape", "Masking Tape", "Packaging Tape", "Double Sided Tape", "Thread Seal Tape", "Foam Tape"],
    sizes: ["3/4 inch", "1 inch", "1.5 inch", "2 inch", "12mm", "24mm", "48mm"],
    finishes: ["Black", "White", "Clear", "Colored", "Yellow"],
    brands: ["Tapemast", "Stickwell", "Bondwrap", "Adhesco", "Tapezone", "Stickit", "Wrappro"],
    packs: ["per roll", "per dozen", "per case", "per pack 4 rolls", "per pack 10 rolls"],
    price: [14, 130],
  },
  {
    category: "Safety Gloves",
    kinds: ["Leather Glove", "Latex Coated Glove", "Cotton Glove", "Welding Glove", "Nitrile Glove", "Cut Resistant Glove", "Rubber Glove"],
    sizes: ["M", "L", "XL", "Free Size", "Size 9", "Size 10", "XXL"],
    finishes: ["Full Coated", "Palm Coated", "Knitted Wrist", "Double Palm", "Gauntlet Cuff"],
    brands: ["Safehand", "Gripguard", "Handshield", "Protekta", "Worksafe", "Glovemart", "Handyfit"],
    packs: ["per pair", "per dozen", "per pack 12 pairs", "per pack 6 pairs", "per box 72 pairs"],
    price: [22, 280],
  },
  {
    category: "Adhesives & Sealants",
    kinds: ["Construction Adhesive", "Silicone Sealant", "Polyurethane Sealant", "Contact Cement", "Epoxy Adhesive", "Acrylic Sealant", "Spray Adhesive"],
    sizes: ["100g tube", "300ml cartridge", "250ml can", "500ml can", "50g tube", "1 liter can", "400ml cartridge"],
    finishes: ["Clear", "White", "Black", "Grey", "Brown"],
    brands: ["Bondseal", "Gluemaster", "Sealit", "Adheseal", "Fixbond", "Siliconex", "Pastepro"],
    packs: ["per tube", "per cartridge", "per can", "per box 24 tubes", "per dozen"],
    price: [45, 650],
  },
  {
    category: "Abrasives",
    kinds: ["Sandpaper Sheet", "Sanding Disc", "Abrasive Roll", "Wire Wheel", "Flap Disc", "Sanding Sponge", "Grinding Disc"],
    sizes: ["#80 grit", "#120 grit", "#150 grit", "#220 grit", "#40 grit", "4 inch", "5 inch"],
    finishes: ["Aluminum Oxide", "Silicon Carbide", "Garnet", "Ceramic", "Zirconia"],
    brands: ["Abrawell", "Grindpro", "Sandflex", "Smoothon", "Gritco", "Surfacepro", "Abramax"],
    packs: ["per sheet", "per pack 10 sheets", "per pack 25 pcs", "per roll", "per box 50 pcs"],
    price: [10, 180],
  },
];

// Decoy-only vocabulary: decoy rows differ from every masterlist combo in at
// least the brand and finish groups, keeping their similarity to real items low.
const DECOY_BRANDS = ["Zebra", "Euroline", "Maxbuild", "Tradewell", "Optima", "Belmont"];
const DECOY_FINISHES = ["Commercial Grade", "Heavy Duty", "Premium", "Industrial"];

const EXCLUSIVE = [
  {
    family: "Lawn Mower",
    brands: ["Zeemax", "Kwiktrim", "Greencut"],
    specs: ["4hp Push", "5hp Push", "6hp Push", "7hp Autodrive", "9hp Autodrive", "11hp Ride On", "13hp Ride On", "15hp Ride On", "5hp Mulching", "7hp Mulching"],
    price: [9000, 26000],
  },
  {
    family: "Chain Saw",
    brands: ["Woodpro", "Timberking", "Sawmax"],
    specs: ["38cc 14in Bar", "38cc 16in Bar", "45cc 16in Bar", "45cc 18in Bar", "52cc 18in Bar", "52cc 20in Bar", "58cc 20in Bar", "62cc 20in Bar", "65cc 24in Bar", "70cc 24in Bar"],
    price: [4500, 12500],
  },
  {
    family: "Air Compressor",
    brands: ["Aquablast", "Hydromax", "Jetstream"],
    specs: ["2hp 4cfm", "2hp 6cfm", "3hp 6cfm", "3hp 8cfm", "5hp 10cfm", "5hp 14cfm", "7hp 17cfm", "10hp 20cfm", "2hp 24liter Tank", "3hp 50liter Tank"],
    price: [3500, 12000],
  },
  {
    family: "Generator",
    brands: ["Maxipower", "Powrgen", "Voltmaster"],
    specs: ["3kva Gasoline", "5kva Gasoline AVR", "6kva Gasoline AVR", "7kva Gasoline", "8kva Diesel AVR", "9kva Diesel", "10kva Diesel AVR", "12kva Diesel AVR", "15kva Diesel AVR", "20kva Diesel AVR"],
    price: [6500, 19000],
  },
];

const SYN = {
  galvanized: "G.I. Coated",
  "zinc plated": "Zinc",
  stainless: "Stainless Steel",
  plain: "Bright Finish",
  inch: "in.",
  "per kg": "per kilo",
  pcs: "pieces",
  "per box": "per carton",
  pair: "pairs",
  roll: "rolls",
  "per dozen": "per dz",
  "per pc": "per piece",
  "black powder coat": "Powder Coated Black",
  "1/2 inch": "half inch",
  "5/8 inch": "five eighth inch",
};
const synGroup = (tokens) => {
  const s = tokens.join(" ").toLowerCase();
  return SYN[s] ? SYN[s].split(" ") : tokens;
};

// ---------------------------------------------------------------------------
// B-row text rendering. Cosmetic noise only — normalization erases it.
function renderRaw(groups) {
  const s = groups.map((g) => g.join(" ")).join(" ");
  let out = s;
  const style = rand(4);
  if (style === 0) out = s.toUpperCase();
  else if (style === 1) out = s.toLowerCase();
  else if (style === 2)
    out = s
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  if (chance(0.12)) out += pick([" .", " ,", "  ", " ---", " *"]);
  if (chance(0.08)) out = " " + out;
  return out.trim() === "" ? s : out;
}

function fmtComma(p) {
  return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtEuro(p) {
  const [i, d] = p.toFixed(2).split(".");
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${d}`;
}
function messyPrice(p) {
  const forms = [`₱${fmtComma(p)}`, `PHP ${fmtComma(p)}`, fmtComma(p), fmtEuro(p), p.toFixed(2)];
  const f = pick(forms);
  const parsed = cleanPrice(f);
  if (parsed === null || Math.abs(parsed - p) > 0.005) throw new Error(`messy price round-trip failed: ${f}`);
  return f;
}

// ---------------------------------------------------------------------------
// Build File A items.
const aItems = []; // {code, groups|null, desc, cleaned, price, category, variant, intended, dupRow}
const aTokenMap = new Map(); // cleaned-token -> Set(aIdx)
const usedComboPerFamily = new Map();

function registerTokens(idx, tokens) {
  for (const t of tokens) {
    const s = aTokenMap.get(t);
    if (s) s.add(idx);
    else aTokenMap.set(t, new Set([idx]));
  }
}
// Candidates sharing <2 tokens cannot score high on bigram dice (few shared
// bigrams), so they are skipped — keeps the checks fast on common words.
// similarity() is ASYMMETRIC (bigram set from arg 1, positions from arg 2):
// the engine always scores (A-item, B-row), so a pair must be checked in both
// directions and the worst case kept.
function sim2(a, b) {
  return Math.max(similarity(a, b), similarity(b, a));
}

function crossMaxSim(variantCleaned, selfIdx) {
  const shared = new Map();
  for (const t of new Set(tokensOf(variantCleaned))) {
    const s = aTokenMap.get(t);
    // Skip only true universals ("per", "box", ...) — a fixed absolute cutoff,
    // NOT a ratio of the growing catalog (a ratio made the check unreliable:
    // common family words flipped in and out of stop-status as it grew).
    if (!s || s.size > 1500) continue;
    for (const i of s) {
      if (i === selfIdx) continue;
      shared.set(i, (shared.get(i) ?? 0) + 1);
    }
  }
  let max = 0;
  for (const [i, c] of shared) {
    if (c < 2) continue;
    const v = sim2(aItems[i].cleaned, variantCleaned);
    if (v > max) max = v;
  }
  return max;
}

let codeNum = 1;
const nextCode = () => `ITM-${String(codeNum++).padStart(5, "0")}`;

// Exclusive items → UNMATCHED (no B row will share any of their tokens).
for (const fam of EXCLUSIVE) {
  const combos = [];
  for (const b of fam.brands) for (const s of fam.specs) combos.push([b, s]);
  const chosen = shuffle(combos).slice(0, UNMATCHED_TARGET / EXCLUSIVE.length);
  for (const [brand, spec] of chosen) {
    const groups = [fam.family.split(" "), brand.split(" "), spec.split(" ")];
    const desc = groups.map((g) => g.join(" ")).join(" ");
    const idx = aItems.length;
    const cleaned = normalizeDescription(desc);
    registerTokens(idx, tokensOf(cleaned));
    aItems.push({
      code: nextCode(),
      groups: null,
      desc,
      cleaned,
      price: round2(fam.price[0] + rng() * (fam.price[1] - fam.price[0])),
      category: fam.family,
      variant: null,
      intended: "UNMATCHED",
      dupRow: null,
    });
  }
}

// per-family target for regular items
const perFamilyTarget = Math.floor((A_TARGET - UNMATCHED_TARGET) / REGULAR.length); // 406
const leftover = A_TARGET - UNMATCHED_TARGET - perFamilyTarget * REGULAR.length; // 8

REGULAR.forEach((fam, famIdx) => {
  const target = perFamilyTarget + (famIdx < leftover ? 1 : 0);
  const allCombos = [];
  for (const k of fam.kinds) for (const s of fam.sizes) for (const f of fam.finishes)
    for (const b of fam.brands) for (const p of fam.packs)
      allCombos.push([k.split(" "), s.split(" "), f.split(" "), b.split(" "), p.split(" ")]);
  const usedCombos = [];
  let made = 0;
  for (const combo of shuffle(allCombos)) {
    if (made >= target) break;
    let diffOk = true;
    for (const u of usedCombos) {
      let diff = 0;
      for (let i = 0; i < 5; i++) if (u[i].join(" ") !== combo[i].join(" ")) diff++;
      if (diff < 2) { diffOk = false; break; }
    }
    if (!diffOk) continue;
    const desc = combo.map((g) => g.join(" ")).join(" ");
    const cleaned = normalizeDescription(desc);
    if (crossMaxSim(cleaned, -1) >= 85) continue;
    const idx = aItems.length;
    registerTokens(idx, tokensOf(cleaned));
    usedCombos.push(combo);
    const sizeFactor =
      1 + 0.15 * (fam.sizes.indexOf(combo[1].join(" ")) / Math.max(fam.sizes.length - 1, 1));
    aItems.push({
      code: nextCode(),
      groups: combo,
      desc,
      cleaned,
      price: round2((fam.price[0] + rng() * (fam.price[1] - fam.price[0])) * sizeFactor),
      category: fam.category,
      variant: null,
      intended: null,
      dupRow: null,
    });
    made++;
  }
  if (made < target) throw new Error(`family ${fam.category}: only ${made}/${target} items`);
  usedComboPerFamily.set(fam.category, usedCombos);
});

// Brute-force audit: no two masterlist descriptions may score >=85 alike, or
// one item's B rows can steal/near-tie the other's match. Token-indexed to
// stay fast, with no stop-token skipping (that's what let bad pairs through).
{
  let violations = 0;
  const checked = new Set();
  for (let i = 0; i < aItems.length; i++) {
    for (const t of tokensOf(aItems[i].cleaned)) {
      const s = aTokenMap.get(t);
      if (!s) continue;
      for (const j of s) {
        if (j <= i) continue;
        // Exclusive items never appear in B, so their mutual similarity is harmless.
        if (!aItems[i].groups && !aItems[j].groups) continue;
        const kk = `${i}|${j}`;
        if (checked.has(kk)) continue;
        checked.add(kk);
        if (sim2(aItems[i].cleaned, aItems[j].cleaned) >= 85) {
          violations++;
          if (violations <= 5) console.log(`A-pair violation: "${aItems[i].desc}" vs "${aItems[j].desc}"`);
        }
      }
    }
  }
  console.log(`A-pair similarity violations: ${violations}`);
  if (violations > 0) throw new Error(`${violations} masterlist pairs are >=85 alike`);
}

// ---------------------------------------------------------------------------
// Variants for B. Transform candidates are measured with the real similarity
// function and bucketed by score, so band placement is guaranteed.
const T = {
  verbatim: (g) => [g[0], g[1], g[2], g[3], g[4]],
  brandFirst: (g) => [g[3], g[0], g[1], g[2], g[4]],
  sizeFirst: (g) => [g[1], g[0], g[2], g[3], g[4]],
  packFront: (g) => [g[4], g[0], g[1], g[2], g[3]],
  reversed: (g) => [g[4], g[3], g[2], g[1], g[0]],
  synOnly: (g) => [synGroup(g[0]), g[1], synGroup(g[2]), g[3], synGroup(g[4])],
  synRotate: (g) => [synGroup(g[2]), synGroup(g[0]), g[3], synGroup(g[1]), synGroup(g[4])],
  dropBrand: (g) => [g[0], g[1], g[2], g[4]],
  dropPack: (g) => [g[0], g[1], g[2], g[3]],
  dropFinish: (g) => [g[0], g[1], g[3], g[4]],
  dropBrandQ: (g) => [g[0], g[1], g[2], ["high", "quality"]],
  dropFinishSyn: (g) => [synGroup(g[0]), synGroup(g[1]), g[3], synGroup(g[4])],
  keepKindSizeBrand: (g) => [synGroup(g[0]), synGroup(g[1]), g[3]],
  keepKindSize: (g) => [g[0], g[1]],
  keepKindFinishHD: (g) => [synGroup(g[0]), synGroup(g[2]), ["heavy", "duty"]],
  minimal: (g) => [g[0], synGroup(g[1])],
};
const LIGHT_T = ["brandFirst", "sizeFirst", "packFront", "reversed", "synOnly"];
const MEDIUM_T = ["synRotate", "dropBrand", "dropPack", "dropFinish", "dropFinishSyn"];
const HARD_T = ["dropBrandQ", "keepKindSizeBrand", "keepKindFinishHD", "keepKindSize", "minimal"];

function bucketOf(sim) {
  if (sim >= 95) return "light";
  if (sim >= 90) return "medium";
  if (sim >= 60) return "hard";
  return "below";
}

const regularIdx = [];
aItems.forEach((it, i) => { if (it.groups) regularIdx.push(i); });

for (const i of regularIdx) {
  const it = aItems[i];
  const roll = rng();
  const wanted = roll < 0.5 ? "exact" : roll < 0.77 ? "light" : roll < 0.92 ? "medium" : "hard";
  const CLASSES = ["exact", "light", "medium", "hard", "below"];

  const build = (name) => {
    const groups = T[name](it.groups);
    if (!groups || groups.length === 0) return null;
    const raw = renderRaw(groups);
    const cleaned = normalizeDescription(raw);
    if (!cleaned) return null;
    const sim = similarity(it.cleaned, cleaned);
    const cls = cleaned === it.cleaned ? "exact" : bucketOf(sim);
    return { name, raw, cleaned, sim, cls, cross: 0 };
  };

  // Pick a variant that is BOTH in the wanted similarity band AND safe for
  // every other A item (cross < 87, else that item could near-tie or steal).
  const tried = new Set();
  let unsafeBest = null;
  const tryList = (names) => {
    for (const name of names) {
      if (tried.has(name)) continue;
      tried.add(name);
      const cand = build(name);
      if (!cand) continue;
      cand.cross = cand.cls === "exact" ? 0 : crossMaxSim(cand.cleaned, i);
      if (cand.cross < 87) return cand;
      if (!unsafeBest || cand.cross < unsafeBest.cross) unsafeBest = cand;
    }
    return null;
  };
  const wantedList =
    wanted === "exact" ? ["verbatim"] :
    wanted === "light" ? shuffle(LIGHT_T) :
    wanted === "medium" ? shuffle(MEDIUM_T) : shuffle(HARD_T);
  let best = tryList(wantedList);
  if (!best)
    best = tryList(shuffle([...LIGHT_T, ...MEDIUM_T, ...HARD_T, "verbatim"].filter((n) => !tried.has(n))));
  if (!best) best = unsafeBest; // last resort: least-harmful row, intend its real bucket
  if (!best) throw new Error(`no variant for item ${i}`);
  it.variant = best;
  if (best.cls === "hard" || best.cls === "below") it.intended = "PROBABLE";
}

// Price rolls: same / different (valuation evidence, not identity) / unreadable.
// A price gap never changes the status any more — the flag `gapPrice` only
// makes the B price differ so the valuation layer has an above/below-range
// population to show. Under the identity model, ONLY an exact normalized
// description earns STRONG; anything fuzzy is PROBABLE by design.
const blankAPrice = new Set();
{
  const eligible = regularIdx.filter((i) => aItems[i].intended === null);
  let blanksLeft = 12;
  for (const i of eligible) {
    const it = aItems[i];
    const r = rng();
    it.intended = it.variant?.cls === "exact" ? "STRONG" : "PROBABLE";
    it.gapPrice = r >= 0.8; // ~20% carry a different (explained-later) price
    if (blanksLeft > 0 && chance(0.004)) {
      blankAPrice.add(i);
      blanksLeft--;
    }
  }
}

// Part-code subset → CONFIRMED: codes embedded in the A description (the real
// Ending Inventory carries codes inside the text) and mirrored in the B
// "Part No." column (the real Costing file's strongest identity signal).
{
  const pool = regularIdx.filter(
    (i) => aItems[i].intended === "STRONG" && !blankAPrice.has(i),
  );
  const chosen = shuffle(pool).slice(0, CONFIRMED_TARGET);
  let pn = 1000;
  for (const i of chosen) {
    const it = aItems[i];
    const style = rand(3);
    const raw =
      style === 0
        ? `A-${pn}`
        : style === 1
          ? `KBJ-${pn}`
          : `${1 + rand(4)}${String(pn).padStart(5, "0")}-0L${rand(10)}${rand(10)}`;
    it.partCode = raw;
    it.desc = `${it.desc} ${raw}`; // append keeps the answer-key containment check valid
    it.cleaned = normalizeDescription(it.desc);
    it.intended = "CONFIRMED";
    pn += 1 + rand(9);
  }
}

// CONFLICT cases: the part number matches but the costing row describes a
// DIFFERENT product (the expert's 23390-0L070 = "Fuel Filter, Hi-Lux/Innova"
// vs inventory "AIR FILTER 23390-0L070"). These items get a private code whose
// only costing row is a wholly unrelated automotive part — word overlap is zero,
// so the engine must report CONFLICT and accept nothing.
const CONFLICT_DESCS = [
  "Windshield Washer Pump",
  "Heads-Up Display Unit",
  "Seat Belt Tensioner",
  "Sunroof Drain Tube",
  "Vapor Canister Valve",
  "Cabin Blower Motor",
];
{
  const pool = shuffle(
    regularIdx.filter(
      (i) =>
        aItems[i].intended === "PROBABLE" &&
        !blankAPrice.has(i) &&
        !aItems[i].partCode &&
        !aItems[i].dupRow,
    ),
  );
  let cn = 700;
  for (const i of pool.slice(0, CONFLICT_TARGET)) {
    const it = aItems[i];
    it.conflictCode = `K${cn}`;
    it.conflictDesc = CONFLICT_DESCS[cn % CONFLICT_DESCS.length];
    it.desc = `${it.desc} ${it.conflictCode}`;
    it.cleaned = normalizeDescription(it.desc);
    it.intended = "CONFLICT";
    cn += 1;
  }
}

// Duplicates: a second B record for the same identity (collect-all — no
// picking, no locking; both records feed the item's valuation range).
{
  const exactIdx = shuffle(
    regularIdx.filter(
      (i) =>
        aItems[i].variant?.cls === "exact" &&
        !blankAPrice.has(i) &&
        (aItems[i].intended === "STRONG" || aItems[i].intended === "CONFIRMED"),
    ),
  );
  for (const i of exactIdx.slice(0, DUP_TARGET)) {
    aItems[i].dupRow = { raw: renderRaw(T.verbatim(aItems[i].groups)), price: null };
  }
}

// ---------------------------------------------------------------------------
// Assemble File B rows.
const bRows = []; // {raw, priceRaw, sourceAIdx|null, partCode|null}
function priceForAItem(it) {
  if (it.gapPrice) {
    const pct = 5 + rand(41);
    return round2(chance(0.5) ? it.price * (1 + pct / 100) : it.price * (1 - pct / 100));
  }
  return it.price;
}
for (const i of regularIdx) {
  const it = aItems[i];
  // Conflict items get exactly one costing row carrying their private part
  // number but describing an unrelated product — the classic mis-keyed part.
  if (it.conflictCode) {
    bRows.push({
      raw: renderRaw([it.conflictDesc.split(" ")]),
      priceRaw: chance(0.25) ? 0 : round2(it.price * (0.8 + rng() * 0.6)),
      sourceAIdx: i,
      partCode: it.conflictCode,
    });
    continue;
  }
  const partCode = it.partCode ?? null;
  if (it.dupRow) {
    bRows.push({ raw: it.variant.raw, priceRaw: it.price, sourceAIdx: i, partCode });
    const dupPrice = chance(0.5) ? it.price : round2(it.price * 1.12);
    it.dupRow.price = dupPrice;
    bRows.push({ raw: it.dupRow.raw, priceRaw: dupPrice, sourceAIdx: i, partCode });
  } else {
    const p = priceForAItem(it);
    let priceRaw = p;
    if (it.intended === "PROBABLE" && blankAPrice.has(i)) {
      priceRaw = pick(["N/A", "TBA", ""]); // unreadable B price
    } else if (chance(0.10)) {
      priceRaw = 0; // zero-price costing lines (the real Costing file has ~43%)
    } else if (chance(0.06)) priceRaw = messyPrice(p);
    bRows.push({ raw: it.variant.raw, priceRaw, sourceAIdx: i, partCode });
  }
}

// Decoys: kind + size + decoy-exclusive finish + decoy-exclusive brand + pack.
// They differ from every masterlist combo in >=2 groups, so their similarity to
// real items stays low; the assert below keeps that guaranteed.
{
  const need = B_TARGET - bRows.length;
  const takenCleaned = new Set(bRows.map((r) => normalizeDescription(r.raw)));
  const made = [];
  const famDecoyTarget = Math.ceil(need / REGULAR.length);
  REGULAR.forEach((fam) => {
    const seen = new Set();
    let madeFam = 0;
    for (let attempt = 0; attempt < famDecoyTarget * 40 && madeFam < famDecoyTarget; attempt++) {
      const combo = [
        pick(fam.kinds).split(" "),
        pick(fam.sizes).split(" "),
        pick(DECOY_FINISHES).split(" "),
        pick(DECOY_BRANDS).split(" "),
        pick(fam.packs).split(" "),
      ];
      const cleaned = normalizeDescription(combo.map((g) => g.join(" ")).join(" "));
      if (seen.has(cleaned) || takenCleaned.has(cleaned)) continue;
      if (crossMaxSim(cleaned, -1) >= 87) continue;
      seen.add(cleaned);
      takenCleaned.add(cleaned);
      made.push({ combo });
      madeFam++;
    }
    if (madeFam < famDecoyTarget) throw new Error(`decoys short for ${fam.category}: ${madeFam}/${famDecoyTarget}`);
  });
  console.log(`decoys generated: ${made.length} (needed ${need})`);
  let dn = 50000;
  for (const d of made) {
    // Decoys can carry Part No. values too (the real Costing file does), but
    // from a disjoint ZZ- pool so they never confirm against the masterlist.
    const partCode = chance(0.6) ? `ZZ-${dn++}` : null;
    bRows.push({
      raw: renderRaw(d.combo),
      priceRaw: chance(0.12) ? 0 : round2(10 + rng() * 2000),
      sourceAIdx: null,
      partCode,
    });
  }
}

// Shuffle B so statuses don't cluster by row order, then fix row numbers.
const bShuffled = shuffle(bRows);
bShuffled.forEach((r, i) => { r.rowNum = i + 2; });

// ---------------------------------------------------------------------------
// Validations before writing anything.
const bCleanedTokens = new Set();
for (const r of bShuffled) for (const t of tokensOf(normalizeDescription(r.raw))) bCleanedTokens.add(t);
for (const it of aItems) {
  if (it.intended !== "UNMATCHED") continue;
  for (const t of tokensOf(it.cleaned)) {
    if (bCleanedTokens.has(t)) throw new Error(`UNMATCHED item token leaked into B: ${it.desc} [${t}]`);
  }
}

const aNames = aItems.map((it) => `${it.code} ${it.desc}`);
console.log(`A rows: ${aItems.length}, B rows: ${bShuffled.length}`);
console.log(`code strip mode: ${detectCodeStripMode(aNames).mode}`);

const t0 = Date.now();
const engine = runMatching(
  aItems.map((it, i) => ({
    rowNum: i + 2,
    rawName: aNames[i],
    rawPrice: blankAPrice.has(i) ? null : it.price,
  })),
  bShuffled.map((r) => ({ rowNum: r.rowNum, rawName: r.raw, rawPrice: r.priceRaw, rawCode: r.partCode })),
  DEFAULT_SETTINGS,
);
console.log(`engine run: ${Date.now() - t0}ms`);
console.log("status distribution:", engine.stats);

// Confusion matrix: intended vs actual.
const statuses = ["CONFIRMED", "STRONG", "PROBABLE", "CONFLICT", "UNMATCHED"];
const confusion = Object.fromEntries(statuses.map((s) => [s, Object.fromEntries(statuses.map((t) => [t, 0]))]));
aItems.forEach((it, i) => {
  confusion[it.intended ?? "STRONG"][engine.results[i].status]++;
});
console.log("confusion (row = intended, col = actual):");
for (const s of statuses)
  console.log(`  ${s.padEnd(13)}`, statuses.map((t) => `${t[0]}:${confusion[s][t]}`).join(" "));

// Show the handful of items whose actual status escaped the intended bucket.
aItems.forEach((it, i) => {
  const intended = it.intended ?? "STRONG";
  const actual = engine.results[i].status;
  if (intended !== actual) {
    console.log(
      `anomaly: "${it.desc}" intended=${intended} actual=${actual} variant=${it.variant?.name}/${it.variant?.cls}/sim${it.variant?.sim}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Write the two workbooks + answer key. Layout mirrors the REAL files: the
// Ending Inventory declares a blank "Product / Inventory Code" and an all-zero
// "Code" column (identity must come from the descriptions), while the Costing
// file carries a populated "Part No." column.
fs.mkdirSync(OUT_DIR, { recursive: true });
const aAoa = [["Item Name", "Product / Inventory Code", "Code", "Category", "Unit Price"]];
aItems.forEach((it, i) => {
  const priceRaw = blankAPrice.has(i) ? null : chance(0.05) ? messyPrice(it.price) : it.price;
  aAoa.push([`${it.code} ${it.desc}`, null, 0, it.category, priceRaw]);
});
const bAoa = [["Description", "Part No.", "Qty", "Unit Price"]];
for (const r of bShuffled) bAoa.push([r.raw, r.partCode ?? null, 1 + rand(50), r.priceRaw === "" ? null : r.priceRaw]);

const wbA = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wbA, XLSX.utils.aoa_to_sheet(aAoa), "Masterlist");
// XLSX.writeFile cannot find fs under Node ESM — write the buffer ourselves.
fs.writeFileSync(path.join(OUT_DIR, "masterlist.xlsx"), XLSX.write(wbA, { type: "buffer", bookType: "xlsx" }));
const wbB = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wbB, XLSX.utils.aoa_to_sheet(bAoa), "Price File");
fs.writeFileSync(path.join(OUT_DIR, "price_file_to_verify.xlsx"), XLSX.write(wbB, { type: "buffer", bookType: "xlsx" }));

const key = {
  generatedAt: new Date().toISOString(),
  seed: SEED,
  files: { a: "masterlist.xlsx", b: "price_file_to_verify.xlsx" },
  items: aItems.map((it, i) => {
    const res = engine.results[i];
    return {
      aRowNum: i + 2,
      code: it.code,
      name: it.desc,
      partCode: it.partCode ?? null,
      aPrice: it.price,
      intended: it.intended ?? "STRONG",
      actual: res.status,
      aCodes: res.aCodes,
      candidateCount: res.candidates.length,
      bRowNum: res.chosen?.bRowNum ?? null,
      bName: res.chosen?.rawName ?? null,
      bPrice: res.chosen?.price ?? null,
      method: res.method,
      score: res.score,
    };
  }),
};
fs.writeFileSync(path.join(import.meta.dirname, "dummy-answer-key.json"), JSON.stringify(key, null, 1));

// Verify the upload screen's auto-detection against the written files.
for (const [file, sheetName] of [
  ["masterlist.xlsx", "Masterlist"],
  ["price_file_to_verify.xlsx", "Price File"],
]) {
  const wb = XLSX.read(fs.readFileSync(path.join(OUT_DIR, file)), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1, raw: true, defval: null, blankrows: true,
  });
  const analyzed = analyzeSheet({ name: sheetName, rows });
  const nameCol = analyzed.columns.find((c) => c.index === analyzed.mapping.nameCol);
  const priceCol = analyzed.columns.find((c) => c.index === analyzed.mapping.priceCol);
  const codeCol =
    analyzed.mapping.codeCol === null
      ? "(none)"
      : analyzed.columns.find((c) => c.index === analyzed.mapping.codeCol).label;
  console.log(
    `${file}: headerRow=${analyzed.headerRow} name="${nameCol.label}" price="${priceCol.label}" codeCol=${codeCol} dataRows=${analyzed.dataRowCount}`,
  );
}

const anyStatusEmpty = statuses.some((s) => engine.stats[s] === 0);
console.log(anyStatusEmpty ? "FAIL: some status has zero rows" : "all five statuses present");
process.exit(anyStatusEmpty ? 1 : 0);
