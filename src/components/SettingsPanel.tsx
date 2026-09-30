"use client";

import { useState } from "react";
import type { Settings } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { getJevKey, setJevKey } from "@/lib/jev";

interface Props {
  settings: Settings;
  resolvedCodeStrip: Settings["codeStrip"] | null;
  /** Depreciation allowance (%) applied to displayed statuses (ACV mode). */
  depreciationPct: number;
  /** Applies immediately — no re-run needed (display-layer reclassification). */
  onDepreciationChange: (pct: number) => void;
  onApply: (s: Settings) => void;
}

export default function SettingsPanel({
  settings,
  resolvedCodeStrip,
  depreciationPct,
  onDepreciationChange,
  onApply,
}: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [jevKey, setJevKeyState] = useState<string>(() => getJevKey());
  const [jevInput, setJevInput] = useState("");
  const [showKeyInput, setShowKeyInput] = useState(() => !getJevKey());

  const invalid =
    draft.autoAccept < 50 ||
    draft.autoAccept > 100 ||
    draft.reviewFloor < 0 ||
    draft.reviewFloor >= draft.autoAccept ||
    draft.priceTolerance < 0 ||
    draft.priceTolerance > 50 ||
    (draft.codeStrip.mode === "regex" && !draft.codeStrip.regex?.trim());

  return (
    <div className="grid gap-6 pb-10 lg:grid-cols-2">
      <section className="space-y-4 rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-sm ring-1 ring-slate-200 dark:ring-slate-800">
        <div>
          <h2 className="font-semibold text-slate-900 dark:text-slate-50">Matching thresholds</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Applied when you re-run the comparison. Nothing is hard-coded.
          </p>
        </div>

        <NumField
          label="Auto-accept cutoff"
          hint="Fuzzy score at or above this counts as a match (50–100)."
          value={draft.autoAccept}
          min={50}
          max={100}
          onChange={(v) => setDraft({ ...draft, autoAccept: v })}
        />
        <NumField
          label="Review floor"
          hint="Scores below this are dropped, except the single best candidate (0–auto-accept)."
          value={draft.reviewFloor}
          min={0}
          max={draft.autoAccept - 1}
          onChange={(v) => setDraft({ ...draft, reviewFloor: v })}
        />
        <NumField
          label="Price tolerance (%)"
          hint="A gap up to this percentage of the claimed price still counts as a Match (0 = exact). Up to 50%."
          value={draft.priceTolerance}
          min={0}
          max={50}
          step={0.5}
          onChange={(v) => setDraft({ ...draft, priceTolerance: v })}
        />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tolerance presets">
          {[0, 5, 10, 15, 20, 25, 50].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setDraft({ ...draft, priceTolerance: p })}
              className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 transition ${
                draft.priceTolerance === p
                  ? "bg-indigo-600 text-white ring-indigo-600"
                  : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
              }`}
            >
              {p === 0 ? "Exact" : `±${p}%`}
            </button>
          ))}
        </div>

        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-4">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Depreciation allowance (ACV mode)
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            When the adjuster valued items at actual cash value, verified prices
            sitting below the claim by up to this percentage are expected — they
            are reclassified to Match with a note instead of Mismatch. Applies
            instantly, no re-run needed. 0 = off.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Depreciation presets">
            {[0, 5, 10, 15, 20, 30, 50].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onDepreciationChange(p)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 transition ${
                  depreciationPct === p
                    ? "bg-indigo-600 text-white ring-indigo-600"
                    : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
                }`}
              >
                {p === 0 ? "Off" : `−${p}%`}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Current: {depreciationPct === 0 ? "off" : `gaps up to −${depreciationPct}% treated as expected`}.
          </p>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Item-code stripping</span>
          <select
            value={draft.codeStrip.mode}
            onChange={(e) =>
              setDraft({
                ...draft,
                codeStrip: { mode: e.target.value as Settings["codeStrip"]["mode"] },
              })
            }
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          >
            <option value="auto">Auto-detect</option>
            <option value="firstToken">First token is the code</option>
            <option value="lastToken">Last token is the code</option>
            <option value="regex">Custom regex</option>
            <option value="none">Don&apos;t strip</option>
          </select>
        </label>
        {draft.codeStrip.mode === "regex" && (
          <input
            value={draft.codeStrip.regex ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, codeStrip: { mode: "regex", regex: e.target.value } })
            }
            placeholder="e.g. ^[A-Z]{2,}-\d+\s+"
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
          />
        )}
        {resolvedCodeStrip && draft.codeStrip.mode === "auto" && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Detected on the last run: <span className="font-semibold">{resolvedCodeStrip.mode}</span>
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => onApply(draft)}
            disabled={invalid}
            className="flex-1 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Apply &amp; re-run comparison
          </button>
          <button
            onClick={() => setDraft(DEFAULT_SETTINGS)}
            className="rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60"
            title="Restore the default thresholds"
          >
            Reset
          </button>
        </div>
        {invalid && (
          <p className="text-xs text-rose-600">
            Check the values: review floor must stay below the auto-accept cutoff, and a regex is
            required in regex mode.
          </p>
        )}
      </section>

      <section className="space-y-4 rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-sm ring-1 ring-slate-200 dark:ring-slate-800">
        <div>
          <h2 className="font-semibold text-slate-900 dark:text-slate-50">Jev — AI screening (TypeSafe AI)</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Jev screens the Needs-review bucket: same item or not. Your API key is stored only in
            this browser (localStorage) and is never sent anywhere except directly to TypeSafe.
          </p>
        </div>

        {jevKey ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              Jev connected
              <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">
                ••••{jevKey.slice(-4)}
              </span>
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowKeyInput(true);
                  setJevInput("");
                }}
                className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                Replace key
              </button>
              <button
                onClick={() => {
                  setJevKey("");
                  setJevKeyState("");
                  setShowKeyInput(false);
                }}
                className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : showKeyInput ? (
          <div className="space-y-2">
            <input
              type="password"
              value={jevInput}
              onChange={(e) => setJevInput(e.target.value)}
              placeholder="Paste your TypeSafe AI API key"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setJevKey(jevInput);
                  setJevKeyState(jevInput.trim());
                  setShowKeyInput(false);
                }}
                disabled={!jevInput.trim()}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
              >
                Save key
              </button>
              <button
                onClick={() => setShowKeyInput(false)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Get a key from your TypeSafe AI account. The app works fully without Jev — review
              items simply wait for manual screening.
            </p>
          </div>
        ) : (
          <button
            onClick={() => setShowKeyInput(true)}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Connect Jev
          </button>
        )}
      </section>
    </div>
  );
}

function NumField({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="w-40 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm tabular-nums outline-none focus:border-indigo-500"
      />
      <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{hint}</span>
    </label>
  );
}
