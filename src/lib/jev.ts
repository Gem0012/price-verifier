"use client";

const STORAGE_KEY = "pv_jev_api_key";

/** One pair to screen: File A item name vs the chosen File B candidate name. */
export interface JevPair {
  id: number;
  aName: string;
  bName: string;
}

/** Typed decision returned by Jev (System One) for a pair. */
export interface JevDecision {
  id: number;
  verdict: "MATCH" | "NOT_MATCH" | "UNCERTAIN";
  /** Confidence as an integer percentage (0–100). */
  confidence: number;
}

/**
 * Screen pairs with Jev via the same-origin /api/jev proxy. The key is sent
 * per-request as `Authorization: Bearer <key>` and never stored server-side.
 * Pairs are sent in small chunks so callers can show live progress; the
 * returned decisions cover every pair iff no chunk failed (on failure this
 * throws and the caller keeps its current state untouched).
 */
export async function screenNeedsReview(
  pairs: JevPair[],
  key: string,
  onProgress?: (done: number, total: number) => void,
): Promise<JevDecision[]> {
  if (!key.trim()) {
    throw new Error("No Jev API key — connect Jev in Settings first.");
  }
  const decisions: JevDecision[] = [];
  const CHUNK = 10;
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const chunk = pairs.slice(i, i + CHUNK);
    const res = await fetch("/api/jev", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ pairs: chunk }),
    });
    if (!res.ok) {
      let message = `Jev screening request failed (HTTP ${res.status}).`;
      try {
        const data = (await res.json()) as { error?: unknown };
        if (typeof data.error === "string" && data.error) message = data.error;
      } catch {
        // non-JSON error body — keep the generic message
      }
      throw new Error(message);
    }
    const data = (await res.json()) as { decisions?: JevDecision[] };
    if (!Array.isArray(data.decisions)) {
      throw new Error("Unexpected response from the Jev screening endpoint.");
    }
    decisions.push(...data.decisions);
    onProgress?.(Math.min(i + CHUNK, pairs.length), pairs.length);
  }
  return decisions;
}

/** The Jev (TypeSafe AI) key lives ONLY in this browser's localStorage. */
export function getJevKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setJevKey(value: string): void {
  if (typeof window === "undefined") return;
  try {
    const v = value.trim();
    if (v) window.localStorage.setItem(STORAGE_KEY, v);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // private mode etc. — the app stays fully functional without Jev
  }
}
