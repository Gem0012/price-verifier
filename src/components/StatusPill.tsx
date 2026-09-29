import type { Status } from "@/lib/types";
import { STATUS_NAMES } from "@/lib/report-workbook";

export { STATUS_NAMES };

const PILL_STYLES: Record<Status, string> = {
  MATCH: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-800",
  MISMATCH: "bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-300 ring-rose-200 dark:ring-rose-800",
  MULTIPLE: "bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300 ring-orange-200 dark:ring-orange-800",
  NEEDS_REVIEW: "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 ring-amber-200 dark:ring-amber-800",
  NOT_FOUND: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-800",
};

export function StatusPill({ status }: { status: Status }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${PILL_STYLES[status]}`}
    >
      {STATUS_NAMES[status]}
    </span>
  );
}

export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function fmtSigned(n: number): string {
  const s = fmtMoney(Math.abs(n));
  if (n > 0) return `+${s}`;
  if (n < 0) return `−${s}`;
  return s;
}
