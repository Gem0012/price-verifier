"use client";

import type { MatchResult, Settings } from "@/lib/types";
import {
  buildReportBuffer,
  type RunStatsLike,
  type QtyMaps,
  type ReportOptions,
} from "./report-workbook";

/** Build the report and trigger a browser download of price_comparison_report.xlsx. */
export async function downloadReport(
  results: MatchResult[],
  stats: RunStatsLike,
  settings: Settings,
  fileNames: { a: string; b: string } | null,
  qty?: QtyMaps,
  options?: ReportOptions,
): Promise<void> {
  const buf = await buildReportBuffer(results, stats, settings, fileNames, qty, options);
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "price_comparison_report.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
