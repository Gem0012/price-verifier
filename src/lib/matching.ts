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
import {
  dimsConflict,
  extractIdentity,
  wordOverlap,
  type Identity,
} from "./identity.ts";

export interface EngineInputRow {
  rowNum: number;
  rawName: unknown;
  rawPrice: unknown;
  /** Optional structured part/model code column value (Costing files carry one). */
  rawCode?: unknown;
}

export interface EngineStats {
  total: number;
  CONFIRMED: number;
  STRONG: number;
  PROBABLE: number;
  CONFLICT: number;
  UNMATCHED: number;
}

export interface EngineOutput {
  results: MatchResult[];
  stats: EngineStats;
  resolvedCodeStrip: Settings["codeStrip"];
}

const FUZZY_POOL = 400; // max fuzzy candidates scored per A row
const STORED_CANDIDATES = 50; // candidates kept per row; valuation reads this set
/** Below this word-overlap a code-matched pair is flagged as a description conflict. */
const CONFLICT_OVERLAP = 0.3;

interface BPrep {
  rowNum: number;
  rawName: string;
  cleaned: string;
  altCleaned: string | null;
  rawPrice: unknown;
  price: number | null;
  identity: Identity;
  grams: { stripped: string; grams: number[] };
  gramSet: Set<number>;
  tokens: Map<string, number>;
}

interface AGrams {
  stripped: string;
  grams: Set<number>;
  tokens: Map<string, number>;
}

/**
 * Three-layer matching engine (layer 1 — identification only):
 *
 *   Stage 0  exact part/model code match   → CONFIRMED (or CONFLICT when the
 *            descriptions describe different products despite the shared code)
 *   Stage 1  exact normalized description  → STRONG
 *   Stage 2  fuzzy suggestion              → PROBABLE (never auto-accepted)
 *   no evidence at all                     → UNMATCHED
 *
 * Fuzzy matching only SUGGESTS candidates; it never decides identity. Price is
 * NOT an identity criterion — it is recorded as evidence (difference vs the
 * chosen reference record) for the separate valuation layer.
 */
export function runMatching(
  aRows: EngineInputRow[],
  bRows: EngineInputRow[],
  settings: Settings,
  onProgress?: (done: number, total: number) => void,
): EngineOutput {
  const reviewFloor = Math.max(0, Math.min(settings.reviewFloor, 99));

  const codeCfg =
    settings.codeStrip.mode === "auto"
      ? detectCodeStripMode(aRows.map((r) => String(r.rawName ?? "")))
      : settings.codeStrip;

  // ---- Prepare B side ------------------------------------------------------
  const bPrep: BPrep[] = bRows.map((r) => {
    const rawName = String(r.rawName ?? "").trim();
    const cleaned = normalizeDescription(rawName);
    return {
      rowNum: r.rowNum,
      rawName,
      cleaned,
      altCleaned: null,
      rawPrice: r.rawPrice,
      price: cleanPrice(r.rawPrice),
      identity: extractIdentity(rawName, r.rawCode),
      grams: numericGrams(cleaned),
      gramSet: numericGramSet(cleaned),
      tokens: tokenCounts(cleaned),
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

  // Part/model code index: normalized code -> B row indices (duplicates kept).
  const codeIndex = new Map<string, number[]>();
  bPrep.forEach((b, i) => {
    for (const code of b.identity.codes) {
      const arr = codeIndex.get(code);
      if (arr) arr.push(i);
      else codeIndex.set(code, [i]);
    }
  });

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
  const gramCache = new Map<string, AGrams>();
  const gramsFor = (s: string): AGrams => {
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

  // Dice + numeric-sibling penalty against a unique-description key.
  const scoreUnique = (a: AGrams, di: number): number => {
    const base = similarityGramNumbers(a.stripped, a.grams, keyGrams[di]);
    if (base === 100) return 100;
    return Math.max(0, base - numericSiblingPenaltyTokens(a.tokens, keyTokenCounts[di]));
  };

  // Dice + numeric-sibling penalty against one specific B row (code stage —
  // small sets, so a dedicated direct comparison is fine).
  const scoreB = (a: AGrams, bi: number): number => {
    const b = bPrep[bi];
    const base = similarityGramNumbers(a.stripped, a.grams, b.grams);
    if (base === 100) return 100;
    return Math.max(0, base - numericSiblingPenaltyTokens(a.tokens, b.tokens));
  };

  // Pool accumulation buffers reused across A rows.
  const nKeys = uniqueDescs.length;
  const poolScoreArr = new Float64Array(nKeys);
  const touchedFlag = new Uint8Array(nKeys);
  const touched: number[] = [];

  // Fuzzy SUGGESTIONS for one cleaned description, best first. May return the
  // same B row twice when it is indexed under both its full and its
  // code-stripped key — the caller dedupes.
  const fuzzyCandidates = (cleanedA: string): { bi: number; sim: number }[] => {
    const tokens = Array.from(new Set(cleanedA.split(" "))).filter(Boolean);
    if (tokens.length === 0) return [];
    const a = gramsFor(cleanedA);

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
    let pool = touched;
    if (touched.length > FUZZY_POOL) {
      pool = touched
        .sort((x, y) => poolScoreArr[y] - poolScoreArr[x])
        .slice(0, FUZZY_POOL);
    }
    const scored: { bi: number; sim: number }[] = [];
    for (const di of pool) {
      const sim = scoreUnique(a, di);
      if (sim >= reviewFloor) {
        for (const bi of byClean.get(uniqueDescs[di])!) scored.push({ bi, sim });
      }
    }
    for (const di of touched) touchedFlag[di] = 0;
    touched.length = 0;
    scored.sort((x, y) => y.sim - x.sim);
    return scored;
  };

  // ---- Run over File A -----------------------------------------------------
  const results: MatchResult[] = [];
  const stats: EngineStats = {
    total: aRows.length,
    CONFIRMED: 0,
    STRONG: 0,
    PROBABLE: 0,
    CONFLICT: 0,
    UNMATCHED: 0,
  };

  aRows.forEach((row, idx) => {
    const aRawName = String(row.rawName ?? "").trim();
    const aCleaned = aRawName ? normalizeDescription(stripCode(aRawName, codeCfg)) : "";
    const aPrice = cleanPrice(row.rawPrice);
    const notes: string[] = [];

    let status: Status;
    let method: MatchResult["method"] = null;
    let scoreVal: number | null = null;
    let chosen: Candidate | null = null;
    let bPrice: number | null = null;
    let difference: number | null = null;
    let candidates: Candidate[] = [];
    const aIdentity = extractIdentity(aRawName, row.rawCode);

    if (!aRawName) {
      status = "UNMATCHED";
      notes.push("File A row has no item name.");
    } else if (!aCleaned) {
      status = "UNMATCHED";
      notes.push("Description became empty after removing the item code.");
    } else if (isNonItemDescription(aCleaned)) {
      status = "UNMATCHED";
      notes.push(
        "Row does not look like an item (a total/footer line or numbers only) — matching skipped.",
      );
    } else {
      const aGrams = gramsFor(aCleaned);
      const accepted = new Map<number, Candidate>(); // bIndex -> candidate
      const conflicts: Candidate[] = []; // code matches with disagreeing descriptions
      let conflictCount = 0;
      let codeConfirmed = false;

      // Stage 0 — part/model code matches. Every costing row sharing a code is
      // collected: compatible rows become accepted evidence; conflicting rows
      // stay listed but flagged (a shared part number is evidence even when
      // the wording disagrees — the human decides, nothing is discarded).
      if (aIdentity.codes.length > 0) {
        const seen = new Set<number>();
        for (const code of aIdentity.codes) {
          for (const bi of codeIndex.get(code) ?? []) {
            if (seen.has(bi)) continue;
            seen.add(bi);
            const b = bPrep[bi];
            const overlap = wordOverlap(aIdentity.words, b.identity.words);
            if (overlap < CONFLICT_OVERLAP) {
              conflictCount++;
              conflicts.push({
                bRowNum: b.rowNum,
                rawName: b.rawName,
                cleaned: b.cleaned,
                rawPrice: b.rawPrice,
                price: b.price,
                similarity: scoreB(aGrams, bi),
                matchedCode: code,
              });
              notes.push(
                `Part number ${code} also appears on B${b.rowNum} ("${b.rawName}") but the description conflicts — verify before accepting.`,
              );
              continue;
            }
            if (dimsConflict(aIdentity.dims, b.identity.dims)) {
              notes.push(
                `Part number ${code} matches B${b.rowNum} but dimensions differ (${aIdentity.dims.join(", ")} vs ${b.identity.dims.join(", ")}) — verify size.`,
              );
            }
            codeConfirmed = true;
            accepted.set(bi, {
              bRowNum: b.rowNum,
              rawName: b.rawName,
              cleaned: b.cleaned,
              rawPrice: b.rawPrice,
              price: b.price,
              similarity: scoreB(aGrams, bi),
              matchedCode: code,
            });
          }
        }
      }

      // Stage 1 — exact match on the normalized cleaned description. When an
      // exact name exists it is strong evidence even if a conflicting code row
      // was reported above (the conflict note stays).
      if (accepted.size === 0 && conflicts.length === 0) {
        const exactIdx = byClean.get(aCleaned);
        if (exactIdx) {
          for (const bi of exactIdx) {
            const b = bPrep[bi];
            accepted.set(bi, {
              bRowNum: b.rowNum,
              rawName: b.rawName,
              cleaned: b.cleaned,
              rawPrice: b.rawPrice,
              price: b.price,
              similarity: 100,
              matchedCode: null,
            });
          }
        }
      }

      // Stage 2 — fuzzy SUGGESTIONS only. Never auto-accepted: the best the
      // engine grants on fuzzy evidence alone is PROBABLE (manual review).
      // Skipped when only conflicting code rows were found — the CONFLICT
      // verdict must not be papered over by an unrelated fuzzy suggestion.
      if (accepted.size === 0 && conflicts.length === 0) {
        for (const { bi, sim } of fuzzyCandidates(aCleaned)) {
          if (accepted.size >= STORED_CANDIDATES) break;
          if (accepted.has(bi)) continue;
          const b = bPrep[bi];
          accepted.set(bi, {
            bRowNum: b.rowNum,
            rawName: b.rawName,
            cleaned: b.cleaned,
            rawPrice: b.rawPrice,
            price: b.price,
            similarity: sim,
            matchedCode: null,
          });
        }
      }

      // Candidates: compatible evidence first (best score wins the reference
      // slot), conflicting rows after — listed for review, never chosen.
      const acceptedList = [...accepted.values()].sort((x, y) => y.similarity - x.similarity);
      const conflictList = conflicts.sort((x, y) => y.similarity - x.similarity);
      candidates = [...acceptedList, ...conflictList];
      const top = acceptedList[0] ?? null;

      if (acceptedList.length === 0 && conflictCount > 0) {
        // Every code hit conflicts — flag for the insured, accept nothing.
        status = "CONFLICT";
        notes.push(
          `${conflictCount} costing row${conflictCount === 1 ? "" : "s"} share${
            conflictCount === 1 ? "s" : ""
          } this part number but describe a different product — query the insured.`,
        );
      } else if (codeConfirmed) {
        status = "CONFIRMED";
        method = "code";
        if (conflictCount > 0) {
          notes.push(
            `${conflictCount} further costing row${conflictCount === 1 ? "" : "s"} share${
              conflictCount === 1 ? "s" : ""
            } the part number with a conflicting description — see the notes above.`,
          );
        }
        notes.unshift(`Identity by part number: ${aIdentity.codes.join(", ")}.`);
      } else if (acceptedList.length === 0) {
        status = "UNMATCHED";
      } else if (top!.similarity >= 100) {
        status = "STRONG";
        method = "exact";
      } else {
        status = "PROBABLE";
        method = "fuzzy";
        notes.push(
          `Best name similarity ${top!.similarity} — fuzzy evidence only, confirm manually or with Jev.`,
        );
      }

      if (status !== "CONFLICT" && status !== "UNMATCHED") {
        chosen = top;
        scoreVal = top?.similarity ?? null;
        bPrice = top?.price ?? null;
        if (bPrice !== null && aPrice !== null) {
          difference = round2(bPrice - aPrice);
        }
      }
    }

    if (candidates.length > STORED_CANDIDATES) {
      candidates = candidates.slice(0, STORED_CANDIDATES);
    }

    results.push({
      id: idx,
      aRowNum: row.rowNum,
      aRawName,
      aCleaned,
      aRawPrice: row.rawPrice,
      aPrice,
      aCodes: aIdentity.codes,
      status,
      method,
      score: scoreVal,
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
