import type { Candidate, MatchResult, Settings, Status } from "./types.ts";
import {
  cleanPrice,
  detectCodeStripMode,
  isNonItemDescription,
  normalizeDescription,
  numericGramSet,
  numericGrams,
  numericSiblingPenaltyTokens,
  similarityGramNumbers,
  stripCode,
  stripLeadingCode,
  tokenCounts,
} from "./normalize.ts";

export interface EngineInputRow {
  rowNum: number;
  rawName: unknown;
  rawPrice: unknown;
}

export interface EngineStats {
  total: number;
  MATCH: number;
  MISMATCH: number;
  MULTIPLE: number;
  NEEDS_REVIEW: number;
  NOT_FOUND: number;
}

export interface EngineOutput {
  results: MatchResult[];
  stats: EngineStats;
  resolvedCodeStrip: Settings["codeStrip"];
}

const FUZZY_POOL = 400; // max fuzzy candidates scored per A row
const STORED_CANDIDATES = 10; // candidates kept on each result (all for MULTIPLE)
const NEAR_TIE_MARGIN = 3; // runner-up within this many points → MULTIPLE, never a silent pick

export function runMatching(
  aRows: EngineInputRow[],
  bRows: EngineInputRow[],
  settings: Settings,
  onProgress?: (done: number, total: number) => void,
): EngineOutput {
  const autoAccept = clamp(settings.autoAccept, 50, 100);
  const reviewFloor = clamp(settings.reviewFloor, 0, autoAccept - 1);
  const tolerance = Math.max(0, settings.priceTolerance);

  const codeCfg =
    settings.codeStrip.mode === "auto"
      ? detectCodeStripMode(aRows.map((r) => String(r.rawName ?? "")))
      : settings.codeStrip;

  // ---- Prepare B side ------------------------------------------------------
  const bPrep = bRows.map((r) => {
    const rawName = String(r.rawName ?? "").trim();
    return {
      rowNum: r.rowNum,
      rawName,
      cleaned: normalizeDescription(rawName),
      altCleaned: null as string | null,
      rawPrice: r.rawPrice,
      price: cleanPrice(r.rawPrice),
    };
  });

  // cleaned description -> indices into bPrep (duplicates are preserved!).
  // Total/footer rows ("TOTAL", page numbers, digits-only cells) are not items
  // on either side — they are kept out of the index entirely.
  const byClean = new Map<string, number[]>();
  const indexKey = (key: string, i: number) => {
    if (!key || isNonItemDescription(key)) return;
    const arr = byClean.get(key);
    if (arr) arr.push(i);
    else byClean.set(key, [i]);
  };
  bPrep.forEach((b, i) => {
    if (!b.cleaned) return;
    indexKey(b.cleaned, i);
  });

  // When File A uses leading item codes, File B rows often carry a stray copy
  // of the same code ("ITM-0009 Safety Glove Leather") or a vendor/SKU prefix.
  // Register those rows a second time under the code-stripped description so
  // they can match exactly; fuzzy scoring takes the best of both variants.
  const useAltKeys = codeCfg.mode === "firstToken";
  if (useAltKeys) {
    bPrep.forEach((b, i) => {
      if (!b.cleaned) return;
      const alt = stripLeadingCode(b.cleaned);
      if (!alt || alt === b.cleaned) return;
      b.altCleaned = alt;
      indexKey(alt, i);
    });
  }

  // Inverted index over unique indexed descriptions for the fuzzy stage.
  const uniqueDescs = Array.from(byClean.keys());
  const postings = new Map<string, number[]>();
  uniqueDescs.forEach((desc, di) => {
    for (const t of new Set(desc.split(" "))) {
      if (!t) continue;
      const p = postings.get(t);
      if (p) p.push(di);
      else postings.set(t, [di]);
    }
  });
  const idfCache = new Map<string, number>();
  const idf = (token: string): number => {
    let v = idfCache.get(token);
    if (v === undefined) {
      v = Math.log(1 + uniqueDescs.length / Math.max(postings.get(token)!.length, 1));
      idfCache.set(token, v);
    }
    return v;
  };

  // Precomputed numeric grams for every unique indexed description: identical
  // similarity values, but no string allocation in the hot scoring loop.
  const keyGrams = uniqueDescs.map((d) => numericGrams(d));
  const keyTokenCounts = uniqueDescs.map((d) => tokenCounts(d));

  // Per-A-row gram sets: computed once per distinct cleaned description.
  const gramCache = new Map<
    string,
    { stripped: string; grams: Set<number>; tokens: Map<string, number> }
  >();
  const gramsFor = (
    s: string,
  ): { stripped: string; grams: Set<number>; tokens: Map<string, number> } => {
    let g = gramCache.get(s);
    if (!g) {
      g = {
        stripped: s.replace(/ /g, ""),
        grams: numericGramSet(s),
        tokens: tokenCounts(s),
      };
      gramCache.set(s, g);
    }
    return g;
  };

  // Fast-path score including the numeric-sibling penalty: identical to
  // similarity(aCleaned, uniqueDesc) for every input pair.
  const score = (
    a: { stripped: string; grams: Set<number>; tokens: Map<string, number> },
    di: number,
  ): number => {
    const base = similarityGramNumbers(a.stripped, a.grams, keyGrams[di]);
    if (base === 100) return 100;
    return Math.max(0, base - numericSiblingPenaltyTokens(a.tokens, keyTokenCounts[di]));
  };

  const makeCandidate = (bi: number, sim: number): Candidate => {
    const b = bPrep[bi];
    return {
      bRowNum: b.rowNum,
      rawName: b.rawName,
      cleaned: b.cleaned,
      rawPrice: b.rawPrice,
      price: b.price,
      similarity: sim,
    };
  };

  // Pool accumulation buffers reused across A rows: identical scores and
  // identical first-touch order as a Map, without hashing every posting.
  const nKeys = uniqueDescs.length;
  const poolScoreArr = new Float64Array(nKeys);
  const touchedFlag = new Uint8Array(nKeys);
  const touched: number[] = [];

  const fuzzyCandidates = (cleanedA: string): Candidate[] => {
    const a = gramsFor(cleanedA);
    const tokens = Array.from(new Set(cleanedA.split(" "))).filter(Boolean);
    if (tokens.length === 0) return [];

    // Rank unique descriptions by IDF-weighted token overlap, keep a bounded pool.
    for (const t of tokens) {
      const post = postings.get(t);
      if (!post) continue;
      const w = idf(t);
      for (const di of post) {
        if (touchedFlag[di]) {
          poolScoreArr[di] += w;
        } else {
          touchedFlag[di] = 1;
          poolScoreArr[di] = w;
          touched.push(di);
        }
      }
    }
    // Stable sort by score: ties keep first-touch order, exactly like sorting
    // the keys of the old Map. Only the top FUZZY_POOL entries are kept.
    let pool = touched;
    if (touched.length > FUZZY_POOL) {
      pool = touched
        .sort((x, y) => poolScoreArr[y] - poolScoreArr[x])
        .slice(0, FUZZY_POOL);
    }
    const scored: { di: number; sim: number }[] = [];
    for (const di of pool) {
      const sim = score(a, di);
      if (sim >= reviewFloor) scored.push({ di, sim });
    }
    for (const di of touched) touchedFlag[di] = 0;
    touched.length = 0;
    scored.sort((x, y) => y.sim - x.sim);

    // Expand each unique description back to all of its B rows. A row can be
    // reachable via its full and its code-stripped key — keep the better score.
    const candidates: Candidate[] = [];
    const seenBi = new Set<number>();
    for (const { di, sim } of scored) {
      for (const bi of byClean.get(uniqueDescs[di])!) {
        if (seenBi.has(bi)) continue;
        seenBi.add(bi);
        candidates.push(makeCandidate(bi, sim));
        if (candidates.length >= STORED_CANDIDATES) return candidates;
      }
    }
    return candidates;
  };

  // If nothing clears the review floor, keep the single best candidate anyway.
  const bestBelowFloor = (cleanedA: string): Candidate | null => {
    const tokens = Array.from(new Set(cleanedA.split(" "))).filter(Boolean);
    if (tokens.length === 0) return null;
    const a = gramsFor(cleanedA);
    let best: Candidate | null = null;
    const seen = new Set<number>();
    for (const t of tokens) {
      const post = postings.get(t);
      if (!post) continue;
      for (const di of post) {
        if (seen.has(di)) continue;
        seen.add(di);
        const sim = score(a, di);
        if (best === null || sim > best.similarity) {
          best = makeCandidate(byClean.get(uniqueDescs[di])![0], sim);
        }
      }
    }
    return best;
  };

  // ---- Run over File A -----------------------------------------------------
  const results: MatchResult[] = [];
  const stats: EngineStats = {
    total: aRows.length,
    MATCH: 0,
    MISMATCH: 0,
    MULTIPLE: 0,
    NEEDS_REVIEW: 0,
    NOT_FOUND: 0,
  };

  aRows.forEach((row, idx) => {
    const aRawName = String(row.rawName ?? "").trim();
    const aCleaned = aRawName ? normalizeDescription(stripCode(aRawName, codeCfg)) : "";
    const aPrice = cleanPrice(row.rawPrice);
    const notes: string[] = [];

    let status: Status;
    let method: MatchResult["method"] = null;
    let score: number | null = null;
    let chosen: Candidate | null = null;
    let bPrice: number | null = null;
    let difference: number | null = null;
    let candidates: Candidate[] = [];

    if (!aRawName) {
      status = "NOT_FOUND";
      notes.push("File A row has no item name.");
    } else if (!aCleaned) {
      status = "NOT_FOUND";
      notes.push("Description became empty after removing the item code.");
    } else if (isNonItemDescription(aCleaned)) {
      status = "NOT_FOUND";
      notes.push(
        "Row does not look like an item (a total/footer line or numbers only) — matching skipped.",
      );
    } else {
      // Stage 1 — exact match on the normalized cleaned description.
      const exactIdx = byClean.get(aCleaned);
      if (exactIdx) {
        candidates = exactIdx.map((bi) => makeCandidate(bi, 100));
      } else {
        // Stage 2 — fuzzy match.
        candidates = fuzzyCandidates(aCleaned);
        if (
          candidates.length === 0 ||
          candidates.every((c) => c.similarity < reviewFloor)
        ) {
          const best = bestBelowFloor(aCleaned);
          candidates = best ? [best] : [];
        }
      }

      const top = candidates[0] ?? null;
      if (!top) {
        status = "NOT_FOUND";
      } else if (top.similarity >= autoAccept) {
        const accepted = candidates.filter((c) => c.similarity >= autoAccept);
        const nearTie =
          accepted.length === 1 &&
          candidates.length > 1 &&
          top.similarity - candidates[1].similarity <= NEAR_TIE_MARGIN;
        if (accepted.length > 1 || nearTie) {
          status = "MULTIPLE";
          score = top.similarity;
          notes.push(
            nearTie
              ? "Two candidates are too close to call — pick one manually."
              : `${accepted.length} File B rows match this description — pick one manually.`,
          );
        } else {
          method = top.similarity === 100 ? "exact" : "fuzzy";
          score = top.similarity;
          chosen = top;
          bPrice = top.price;
          if (aPrice === null) {
            status = "NEEDS_REVIEW";
            notes.push("File A price could not be read.");
          } else if (bPrice === null) {
            status = "NEEDS_REVIEW";
            notes.push("File B price could not be read.");
          } else {
            difference = round2(bPrice - aPrice);
            // Tolerance is a percentage of the File A price (0 = exact match).
            const allowed = (Math.abs(aPrice) * tolerance) / 100;
            status = Math.abs(difference) <= allowed ? "MATCH" : "MISMATCH";
          }
        }
      } else {
        status = "NEEDS_REVIEW";
        score = top.similarity;
        notes.push(`Best similarity ${top.similarity} is below the auto-accept cutoff.`);
      }
    }

    // MULTIPLE keeps every candidate (the spec requires listing them all);
    // other statuses keep only the top few.
    if (candidates.length > STORED_CANDIDATES && status !== "MULTIPLE") {
      candidates = candidates.slice(0, STORED_CANDIDATES);
    }

    results.push({
      id: idx,
      aRowNum: row.rowNum,
      aRawName,
      aCleaned,
      aRawPrice: row.rawPrice,
      aPrice,
      status,
      method,
      score,
      candidates,
      chosen,
      bPrice,
      difference,
      jevVerdict: null,
      jevConfidence: null,
      notes,
    });
    stats[status]++;

    if (onProgress && (idx % 250 === 0 || idx === aRows.length - 1)) {
      onProgress(idx + 1, aRows.length);
    }
  });

  return { results, stats, resolvedCodeStrip: codeCfg };
}

function clamp(v: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
