import { NextRequest, NextResponse } from "next/server";

/**
 * Jev (TypeSafe AI "System One") screening proxy.
 *
 * API SHAPE — verified against https://docs.typesafe.ai/api,
 * https://docs.typesafe.ai/concepts/system-one and
 * https://docs.typesafe.ai/primitives/noul (2026-09-29):
 *   POST https://api.typesafe.ai/v1/systemone
 *   Authorization: Bearer <API_KEY>, Content-Type: application/json
 *   Request:  { state: string | object | array,
 *               model: string (e.g. "jev-latest"),
 *               questions: { [id]: { type: "noul", instructions, criteria?: { true, false } } } }
 *   Response: { model: string,
 *               answers: { [id]: { type: "noul", noul: number } },
 *               usage: { input_tokens, output_tokens } }
 * A "noul" answer is the probability (0–1) that the yes/no answer is "yes";
 * per the docs it has no separate `confidence` field — the probability IS the
 * confidence for a two-outcome question.
 *
 * The user's TypeSafe key arrives per-request in this request's Authorization
 * header and is forwarded only to TypeSafe. It is never stored, never logged
 * and never echoed back in any response or error message.
 */

const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";
const QUESTION_ID = "same_item";

/** noul >= this → MATCH (docs suggest a middle band routed to human review). */
const MATCH_THRESHOLD = 0.8;
/** noul <= this → NOT_MATCH; between the two thresholds → UNCERTAIN. */
const NOT_MATCH_THRESHOLD = 0.2;
/** Parallel upstream calls per request (keeps bulk screening quick but polite). */
const UPSTREAM_CONCURRENCY = 5;
/** Hard cap on pairs per request; the client chunks anyway for progress. */
const MAX_PAIRS_PER_REQUEST = 100;
const UPSTREAM_TIMEOUT_MS = 45_000;

interface PairInput {
  id: number;
  aName: string;
  bName: string;
}

interface Decision {
  id: number;
  verdict: "MATCH" | "NOT_MATCH" | "UNCERTAIN";
  confidence: number;
}

/** Error type for upstream auth failures, so the client gets a clear message. */
class TypeSafeAuthError extends Error {
  constructor(status: number) {
    super(
      `TypeSafe rejected the Jev API key (HTTP ${status}). Check the key saved in Settings.`,
    );
    this.name = "TypeSafeAuthError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ask TypeSafe's System One "same item?" for one pair; returns the noul probability. */
async function screenPairNoul(pair: PairInput, apiKey: string): Promise<number> {
  const body = {
    state: [
      `File A item (masterlist description): ${pair.aName}`,
      `File B item (price list description): ${pair.bName}`,
    ].join("\n"),
    model: JEV_MODEL,
    questions: {
      [QUESTION_ID]: {
        type: "noul",
        instructions: "same item?",
        criteria: {
          true: "The two descriptions refer to the same product/item, even if worded differently (item codes, abbreviations, reordered or missing words are allowed).",
          false: "The two descriptions refer to different products/items.",
        },
      },
    },
  };

  // One retry with a short backoff for transient 429 (rate limit) / 529 (overload),
  // per the docs' recommendation to back off and retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(TYPESAFE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch {
      throw new Error(
        "Could not reach TypeSafe (network error or timeout). Try again.",
      );
    }

    if (res.ok) {
      const data = (await res.json().catch(() => null)) as {
        answers?: Record<string, { noul?: unknown }> | null;
      } | null;
      const noul = data?.answers?.[QUESTION_ID]?.noul;
      if (typeof noul !== "number" || !Number.isFinite(noul)) {
        throw new Error(
          "TypeSafe returned an unexpected answer shape (missing noul probability).",
        );
      }
      return Math.min(1, Math.max(0, noul));
    }

    if (res.status === 401 || res.status === 403) {
      throw new TypeSafeAuthError(res.status);
    }
    if (res.status === 429 || res.status === 529) {
      if (attempt === 0) {
        await sleep(800);
        continue;
      }
      throw new Error(
        res.status === 429
          ? "TypeSafe rate limit reached (HTTP 429). Wait a moment and try again."
          : "TypeSafe is overloaded (HTTP 529). Try again shortly.",
      );
    }

    const detail = await res.text().catch(() => "");
    const trimmed = detail.trim().slice(0, 200);
    throw new Error(
      `TypeSafe error (HTTP ${res.status})${trimmed ? `: ${trimmed}` : "."}`,
    );
  }
  // Unreachable: the loop either returns or throws on both attempts.
  throw new Error("TypeSafe request failed after retry.");
}

/** Map the noul probability to a typed decision with an integer confidence percentage. */
function toDecision(id: number, noul: number): Decision {
  const pct = (x: number) => Math.round(x * 100);
  if (noul >= MATCH_THRESHOLD) {
    return { id, verdict: "MATCH", confidence: pct(noul) };
  }
  if (noul <= NOT_MATCH_THRESHOLD) {
    return { id, verdict: "NOT_MATCH", confidence: pct(1 - noul) };
  }
  return { id, verdict: "UNCERTAIN", confidence: pct(Math.max(noul, 1 - noul)) };
}

export async function POST(request: NextRequest) {
  // The key is read from the per-request Authorization header only.
  const auth = request.headers.get("authorization") ?? "";
  const apiKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing Jev API key — connect Jev in Settings first." },
      { status: 401 },
    );
  }

  let pairs: unknown;
  try {
    pairs = (await request.json())?.pairs;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body — expected JSON with a `pairs` array." },
      { status: 400 },
    );
  }
  if (!Array.isArray(pairs)) {
    return NextResponse.json(
      { error: "Invalid request body — `pairs` must be an array." },
      { status: 400 },
    );
  }
  if (pairs.length > MAX_PAIRS_PER_REQUEST) {
    return NextResponse.json(
      {
        error: `Too many pairs in one request (max ${MAX_PAIRS_PER_REQUEST}).`,
      },
      { status: 400 },
    );
  }

  const valid: PairInput[] = [];
  for (const p of pairs) {
    const { id, aName, bName } = (p ?? {}) as Partial<PairInput>;
    if (
      typeof id !== "number" ||
      !Number.isFinite(id) ||
      typeof aName !== "string" ||
      !aName.trim() ||
      typeof bName !== "string" ||
      !bName.trim()
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid pair — each entry needs a numeric `id` and non-empty `aName`/`bName` strings.",
        },
        { status: 400 },
      );
    }
    valid.push({ id, aName, bName });
  }
  if (valid.length === 0) {
    return NextResponse.json({ decisions: [] });
  }

  // Run upstream calls with bounded concurrency.
  const results = new Map<number, number>();
  const errors: Error[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < valid.length) {
      const pair = valid[cursor++];
      try {
        results.set(pair.id, await screenPairNoul(pair, apiKey));
      } catch (err) {
        errors.push(err as Error);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(UPSTREAM_CONCURRENCY, valid.length) }, worker),
  );

  if (errors.length > 0) {
    const first = errors[0].message;
    const prefix =
      errors.length > 1
        ? `Jev screening failed for ${errors.length} of ${valid.length} pairs. First error: `
        : "Jev screening failed: ";
    return NextResponse.json(
      { error: `${prefix}${first}` },
      { status: 502 },
    );
  }

  const decisions: Decision[] = valid
    .filter((p) => results.has(p.id))
    .map((p) => toDecision(p.id, results.get(p.id) as number));

  return NextResponse.json({ decisions });
}
