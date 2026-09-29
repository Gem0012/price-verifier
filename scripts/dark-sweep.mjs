// One-shot dark-variant sweeper for my component files (idempotent per line).
import fs from "node:fs";

const FILES = [
  "src/components/Dashboard.tsx",
  "src/components/ResultsTable.tsx",
  "src/components/ItemDetailModal.tsx",
  "src/components/PriceSummary.tsx",
  "src/components/SettingsPanel.tsx",
  "src/components/StatusPill.tsx",
];

// [regex, replacement] — lookbehind skips hover:/dark: prefixed uses.
const RULES = [
  [/(?<![:-])bg-white(?![\w-])/g, "bg-white dark:bg-slate-900"],
  [/(?<![:-])ring-slate-200(?![\w-])/g, "ring-slate-200 dark:ring-slate-800"],
  [/(?<![:-])ring-slate-300(?![\w-])/g, "ring-slate-300 dark:ring-slate-700"],
  [/(?<![:-])border-slate-300(?![\w-])/g, "border-slate-300 dark:border-slate-700"],
  [/(?<![:-])border-slate-100(?![\w-])/g, "border-slate-100 dark:border-slate-800"],
  [/(?<![:-])bg-slate-50(?![\w-])/g, "bg-slate-50 dark:bg-slate-800/60"],
  [/(?<![:-])text-slate-900(?![\w-])/g, "text-slate-900 dark:text-slate-50"],
  [/(?<![:-])text-slate-800(?![\w-])/g, "text-slate-800 dark:text-slate-100"],
  [/(?<![:-])text-slate-700(?![\w-])/g, "text-slate-700 dark:text-slate-200"],
  [/(?<![:-])text-slate-600(?![\w-])/g, "text-slate-600 dark:text-slate-300"],
  [/(?<![:-])text-slate-500(?![\w-])/g, "text-slate-500 dark:text-slate-400"],
  [/(?<![:-])text-slate-400(?![\w-])/g, "text-slate-400 dark:text-slate-500"],
  [/(?<![:-])hover:bg-slate-100(?![\w-])/g, "hover:bg-slate-100 dark:hover:bg-slate-800"],
  [/(?<![:-])hover:bg-slate-50(?![\w-])/g, "hover:bg-slate-50 dark:hover:bg-slate-800/60"],
  [/(?<![:-])hover:bg-indigo-50\/50(?![\w-])/g, "hover:bg-indigo-50/50 dark:hover:bg-indigo-500/10"],
  // Active/primary surfaces invert in dark mode.
  [/(?<![:-])bg-slate-900(?= text-white)/g, "bg-slate-900 dark:bg-white"],
  [/(?<=bg-slate-900 dark:bg-white )text-white/g, "text-white dark:text-slate-900"],
  // Status pills (light chips → dark translucent chips).
  [/(?<![:-])bg-emerald-100(?![\w-])/g, "bg-emerald-100 dark:bg-emerald-900/40"],
  [/(?<![:-])text-emerald-800(?![\w-])/g, "text-emerald-800 dark:text-emerald-300"],
  [/(?<![:-])ring-emerald-200(?![\w-])/g, "ring-emerald-200 dark:ring-emerald-800"],
  [/(?<![:-])bg-rose-100(?![\w-])/g, "bg-rose-100 dark:bg-rose-900/40"],
  [/(?<![:-])text-rose-800(?![\w-])/g, "text-rose-800 dark:text-rose-300"],
  [/(?<![:-])ring-rose-200(?![\w-])/g, "ring-rose-200 dark:ring-rose-800"],
  [/(?<![:-])bg-orange-100(?![\w-])/g, "bg-orange-100 dark:bg-orange-900/40"],
  [/(?<![:-])text-orange-800(?![\w-])/g, "text-orange-800 dark:text-orange-300"],
  [/(?<![:-])ring-orange-200(?![\w-])/g, "ring-orange-200 dark:ring-orange-800"],
  [/(?<![:-])bg-amber-100(?![\w-])/g, "bg-amber-100 dark:bg-amber-900/40"],
  [/(?<![:-])text-amber-800(?![\w-])/g, "text-amber-800 dark:text-amber-300"],
  [/(?<![:-])ring-amber-200(?![\w-])/g, "ring-amber-200 dark:ring-amber-800"],
  [/(?<![:-])bg-slate-100(?![\w-])/g, "bg-slate-100 dark:bg-slate-800"],
  // Soft banners.
  [/(?<![:-])bg-amber-50(?![\w-])/g, "bg-amber-50 dark:bg-amber-950/40"],
  [/(?<![:-])text-amber-900(?![\w-])/g, "text-amber-900 dark:text-amber-200"],
  [/(?<![:-])bg-rose-50(?![\w-])/g, "bg-rose-50 dark:bg-rose-950/40"],
  [/(?<![:-])text-rose-700(?![\w-])/g, "text-rose-700 dark:text-rose-400"],
  [/(?<![:-])bg-emerald-50(?![\w-])/g, "bg-emerald-50 dark:bg-emerald-950/40"],
  [/(?<![:-])text-emerald-700(?![\w-])/g, "text-emerald-700 dark:text-emerald-400"],
  [/(?<![:-])text-emerald-800(?![\w-])/g, "text-emerald-800 dark:text-emerald-300"],
  [/(?<![:-])bg-indigo-50(?![\w-])/g, "bg-indigo-50 dark:bg-indigo-950/40"],
  [/(?<![:-])text-indigo-900(?![\w-])/g, "text-indigo-900 dark:text-indigo-200"],
  [/(?<![:-])text-indigo-800(?![\w-])/g, "text-indigo-800 dark:text-indigo-200"],
  [/(?<![:-])ring-indigo-200(?![\w-])/g, "ring-indigo-200 dark:ring-indigo-800"],
  [/(?<![:-])ring-indigo-300(?![\w-])/g, "ring-indigo-300 dark:ring-indigo-800"],
  [/(?<![:-])text-emerald-600(?![\w-])/g, "text-emerald-600 dark:text-emerald-400"],
];

let totalChanges = 0;
for (const file of FILES) {
  let src = fs.readFileSync(file, "utf8");
  const lines = src.split("\n");
  let fileChanges = 0;
  const out = lines.map((line) => {
    // Skip lines that already carry dark variants for the touched classes.
    if (/dark:[\w-]+/.test(line)) return line;
    let nl = line;
    for (const [re, rep] of RULES) {
      const before = nl;
      nl = nl.replace(re, rep);
      if (nl !== before) fileChanges++;
    }
    return nl;
  });
  fs.writeFileSync(file, out.join("\n"));
  totalChanges += fileChanges;
  console.log(`${file}: ${fileChanges} class additions`);
}
console.log(`total: ${totalChanges}`);
