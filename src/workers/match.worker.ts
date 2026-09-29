/// <reference lib="webworker" />
import { runMatching } from "../lib/matching.ts";
import type { EngineInputRow } from "../lib/matching.ts";
import type { Settings } from "../lib/types.ts";

export interface MatchWorkerRequest {
  type: "start";
  aRows: EngineInputRow[];
  bRows: EngineInputRow[];
  settings: Settings;
}

export type MatchWorkerResponse =
  | { type: "progress"; done: number; total: number }
  | {
      type: "done";
      results: ReturnType<typeof runMatching>["results"];
      stats: ReturnType<typeof runMatching>["stats"];
      resolvedCodeStrip: Settings["codeStrip"];
    };

self.onmessage = (e: MessageEvent<MatchWorkerRequest>) => {
  if (e.data?.type !== "start") return;
  const { aRows, bRows, settings } = e.data;
  const out = runMatching(aRows, bRows, settings, (done, total) => {
    (self as unknown as Worker).postMessage({
      type: "progress",
      done,
      total,
    } satisfies MatchWorkerResponse);
  });
  (self as unknown as Worker).postMessage({
    type: "done",
    results: out.results,
    stats: out.stats,
    resolvedCodeStrip: out.resolvedCodeStrip,
  } satisfies MatchWorkerResponse);
};
