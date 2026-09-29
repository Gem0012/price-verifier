# Price Verifier

Price Verifier is a Next.js (App Router) web app that audits a supplier's price file against your own masterlist in minutes instead of hours. Upload **File A** (your masterlist — item names that start with an item code, e.g. `ITM-00122 Finishing Nail 2 inch`) and **File B** (the price file to verify — descriptions only, no codes), and the engine matches every masterlist item to its counterpart in the price file by description similarity, then flags each row as one of five statuses:

| Status | Meaning |
| --- | --- |
| **MATCH** | One clear counterpart found, price agrees (within tolerance). |
| **MISMATCH** | One clear counterpart found, but the price differs. |
| **MULTIPLE** | Several File B rows are equally plausible — pick one manually. |
| **NEEDS_REVIEW** | Weak or no confident text match, or an unreadable/blank price. |
| **NOT_FOUND** | Nothing in File B resembles the item at all. |

Everything — file parsing, matching, and reporting — runs **100% in your browser**; nothing is ever persisted server-side.

## Quick start

```bash
npm install

# create .env.local with the password you want to use on the login screen
echo "APP_PASSWORD=my-secret-password" > .env.local

npm run dev
# open http://localhost:3000
```

Opening the app shows a login screen; sign in with the password you put in `APP_PASSWORD`. To try the app immediately, the two workbooks in `public/testdata/` (5,000-item masterlist, ~20,000-row price file) are ready to upload.

## How to use it

1. **Upload both files.** Drop your masterlist (File A) and the price file to verify (File B). The app reads the spreadsheets in the browser and **auto-detects** the sheet, the header row, and which columns hold the item name and the unit price (international header keywords are recognized, and date columns are not mistaken for prices). Dropdowns let you override any detection — the header-row picker covers **rows 1–20** so title blocks and blank rows above the table are handled. A preview shows the first rows so you can confirm the mapping before continuing.
2. **Pre-flight file health panel.** Before you run, each file gets a one-pass health check (`looks good` / `warnings` / `problems`) flagging: blank-name rows, duplicate descriptions, unreadable prices (`N/A`, `TBA`, …), zero and negative prices, Excel dates stored as serial numbers in the price column, and prices stored as text. Each issue comes with sample rows and a one-line "what this means" hint, so mapping surprises are fixed **before** a compare, not discovered after.
3. **Run the comparison.** Matching runs **multi-core**: the File A rows are chunked across Web Workers (one per CPU core) with live progress. The engine skips footer/total rows, rejects date-shaped prices, and penalizes "numeric sibling" descriptions (rows differing only in numbers are pushed out of the auto-accept band — a motor-part safety net).
4. **Review results on the dashboard.** Four tabs:
   - **Full Audit** — every row. Search with the `/` keyboard shortcut, sort any column, filter with the status chips, and filter by **Gap ± %** (show only rows whose price gap is within or beyond a percentage you type). Click a row to open its detail modal.
   - **Action List** — problems only (MISMATCH, MULTIPLE, NEEDS_REVIEW, NOT_FOUND), ready to work through. This is also where **bulk Jev screening** is triggered (see *Connecting Jev*).
   - **Price Summary** — the money view: **claim accuracy** (% of priced rows whose verified price is within the tolerance you ran with), counts and totals of rows verified above vs below claim, potential **overpayment / undercharge exposure**, and a per-status money breakdown.
   - **Settings** — thresholds, item-code stripping, and the Jev API key.
5. **Item detail modal.** Clicking a row shows its File B candidates with similarity scores. For MULTIPLE / NEEDS_REVIEW rows you can **manually pick** the correct candidate — the row is then re-priced against your choice. Individual rows can also be screened with Jev from here.
6. **Dark mode.** The sun/moon toggle switches light/dark, follows your system preference on first visit, and remembers your choice.
7. **Export.** "Export Excel report" downloads `price_comparison_report.xlsx` — a 4-sheet workbook (see *Excel export* below).

## Settings & thresholds

Open the **Settings** tab after a run to tune the engine, then click **Apply & re-run**:

| Setting | Default | Meaning |
| --- | --- | --- |
| Auto-accept cutoff | 90 | Fuzzy similarity (0–100) at or above which a candidate is auto-accepted as MATCH. |
| Review floor | 60 | Below this similarity, candidates are dropped except the single best guess. |
| Price tolerance (%) | 0 (Exact) | A price gap up to this **percentage of the claimed (File A) price** still counts as MATCH — e.g. 10 accepts a ₱100.00 item quoted at ₱109.99. Preset chips: Exact, ±5, ±10, ±15, ±20, ±25, ±50; any value 0–50 is accepted. |
| Item-code stripping | auto | How item codes are removed from A names before matching: auto-detected, none, first token, last token, or a **custom regex**. The resolved mode is shown after a run. |

Defaults live in `DEFAULT_SETTINGS` in `src/lib/types.ts`.

## Connecting Jev

Jev is TypeSafe AI's **"System One"** screening model, used as a second opinion on ambiguous rows.

1. In **Settings**, paste your TypeSafe API key. It is stored **only in your browser's localStorage** — never on the server.
2. Bulk screening (Action List) sends each ambiguous pair of descriptions — the A item name and the chosen B candidate name — through the app's `/api/jev` proxy, which forwards them to `https://api.typesafe.ai/v1/systemone` (model `jev-latest`, a "same item?" question) and **stores nothing**. The key travels per-request as a Bearer header; pairs are sent in small chunks with live progress.
3. Jev answers with a probability ("noul"), mapped to a verdict per pair:
   - probability ≥ 0.8 → **MATCH** — the row is Jev-verified.
   - probability ≤ 0.2 → **NOT_MATCH** — the candidate is rejected.
   - Anything in between → **UNCERTAIN** — the row stays in review for a human decision.

The app is fully functional **without** a Jev key — screening is an optional extra.

## Privacy stance

There is **no database** and nothing is stored server-side. Your spreadsheets are parsed with SheetJS in the browser and matched by Web Workers on your machine. The server does exactly two stateless things: check your password, and proxy Jev requests (your key is forwarded to TypeSafe and never logged or persisted). Close the tab and your data is gone; the only thing this app persists anywhere is your Jev key and theme choice, both in your own browser's localStorage.

## Excel export

The export builds a 4-sheet workbook in the browser:

| Sheet | Contents |
| --- | --- |
| **Summary** | Run timestamp (UTC), file names, status counts, and the exact settings used. |
| **Price Summary** | Σ claimed / Σ verified / net difference / total absolute difference, over- and underpayment exposure, and a per-status money table. |
| **Full Audit** | Every A row with its chosen B row, prices, difference, **Gap %**, method, score, and status. |
| **Action List** | Problems only — the same columns for the rows you need to fix. |

Both table sheets ship with autofilter, a frozen header, zebra striping, and `#,##0.00` money formats. A **Jev Verdict** column appears only when at least one row has a verdict.

## Deploying to Vercel

```bash
npm i -g vercel
vercel login
vercel
```

Then set `APP_PASSWORD` in your Vercel project's environment variables (Project → Settings → Environment Variables) and redeploy. Open the deployed URL on your phone, log in, and verify a real comparison end-to-end — the whole pipeline runs client-side, so a phone browser is a legitimate runtime, not just a viewer.

## Testing scripts

The repo ships scripts that build and verify a full dummy corpus (5,000-item masterlist, ~20,000-row price file, seeded and deterministic):

```bash
node scripts/test-engine.mjs        # engine unit + integration checks (81 checks)
node scripts/make-dummy-data.mjs    # regenerates C:/Files-2.1/masterlist.xlsx,
                                    #   C:/Files-2.1/price_file_to_verify.xlsx and
                                    #   scripts/dummy-answer-key.json with the CURRENT engine
node scripts/acceptance-check.mjs   # acceptance gate: key totals + 8 seeded spot rows
node scripts/verify-export.mjs      # rebuilds and checks the 4-sheet Excel report
```

`make-dummy-data.mjs` validates its own output: every masterlist pair stays below the auto-accept similarity, every B variant is bucketed by its real score, NOT_FOUND items share zero tokens with File B, and the intended-vs-actual confusion matrix is printed (all five statuses must be present or the script exits non-zero). After regenerating, copy the workbooks over the public copies:

```bash
cp C:/Files-2.1/masterlist.xlsx C:/Files-2.1/price_file_to_verify.xlsx public/testdata/
```

`scripts/acceptance-check.mjs` is the acceptance gate: it confirms the answer-key statuses sum to the 5,000 masterlist rows with all five statuses present, then re-derives prices and names from the raw spreadsheet cells (using the same `cleanPrice` / `normalizeDescription` functions as the engine) for a seeded random sample of MATCH and MISMATCH rows. `scripts/verify-export.mjs` rebuilds the report from the answer key and asserts sheet structure, Price Summary totals, the Gap % column, number formats, autofilter/freeze/zebra, and the conditional Jev column.

## Architecture map

```
src/
  app/
    page.tsx                  # app flow: upload → compare → results; owns state, wiring, export
    login/page.tsx            # password login screen
    api/auth/login|logout/    # password check → session cookie
    api/jev/route.ts          # stateless proxy to TypeSafe "System One"; stores nothing
  components/
    UploadScreen.tsx          # file drop, sheet/header/name/price detection + overrides + preview
                              #   + pre-flight health panel
    Dashboard.tsx             # tabs: Full Audit / Action List / Price Summary / Settings; export
    ResultsTable.tsx          # search ("/" shortcut), sort, status chips, Gap ± % filter, pagination
    PriceSummary.tsx          # claim accuracy, over/underpayment exposure, per-status money table
    ItemDetailModal.tsx       # candidate matches, manual pick, Jev screening per row
    SettingsPanel.tsx         # thresholds, tolerance % presets, code-strip mode (incl. regex), Jev key
    StatusPill.tsx            # status badge
    ThemeToggle.tsx           # light/dark toggle (localStorage, system default)
  lib/
    parse.ts                  # workbook reading, header/column auto-detection, previews
    preflight.ts              # upload-time file health check (blank names, dupes, price issues)
    normalize.ts              # cleanPrice, normalizeDescription, similarity, code stripping
    matching.ts               # the matching engine (exact → fuzzy → MULTIPLE/NEEDS_REVIEW/NOT_FOUND)
    runParallel.ts            # multi-core runner: chunks A rows across Web Workers
    jev.ts                    # Jev client: localStorage key, chunked screening calls
    report-workbook.ts        # builds the 4-sheet Excel report
    export.ts                 # browser download of the report
    types.ts                  # shared types + DEFAULT_SETTINGS
  workers/
    match.worker.ts           # Web Worker that runs the engine on a chunk with progress messages
  proxy.ts                    # password gate: every route except /login and /api/auth requires the session cookie
```

`ROBUSTNESS-NOTES.md` documents the real-world file messiness the engine tolerates — wrong header rows, date-shaped prices, footer/total rows, stray codes, full-width characters, international headers — and what to click when your files misbehave.
