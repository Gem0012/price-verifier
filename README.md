# Price Verifier

Price Verifier reconciles two inventories of the same stock loss:

- **File A — the insured's Ending Inventory** (the claim): what the insured says was in the warehouse on the date of loss, with the unit values they are claiming.
- **File B — the adjuster's Costing file**: what the adjuster counted and priced, line by line.

The app answers **three separate questions** about every claim line, and it never
lets one question contaminate another:

| Layer | Question | Decided by |
| --- | --- | --- |
| 1. **Identification** | Is this the same item? | Part/model numbers and normalized descriptions. **Never by price.** |
| 2. **Quantity** | How many were lost? | Quantity columns as supplied. Reported, not independently tested (see *Known gaps*). |
| 3. **Valuation** | What unit cost is allowed? | The full range of costing records found for the identified item. **No price is auto-accepted.** |

Every row of both files survives the run. The claim side is reported in *Full
Audit* / *Action List*; the costing side is reported in full in the *Adjuster
Ledger*.

Everything — reading the files, matching, and building the report — runs in your
browser. No file is ever uploaded and no result is ever stored.

## The five statuses

| Status | Meaning |
| --- | --- |
| **CONFIRMED** | Identity established by a unique part/model number. |
| **STRONG** | Identity established by an exact normalized description. |
| **PROBABLE** | Fuzzy name similarity only. A suggestion for a human — **never auto-accepted**. |
| **CONFLICT** | The part number matches, but the description describes a different product. Query the insured. |
| **UNMATCHED** | No usable identity evidence on the other side. |

> **CONFLICT in practice.** The inventory says `AIR FILTER 23390-0L070`. The
> costing file lists `23390-0L070` as *Fuel Filter, Hi-Lux/Innova '16*. The part
> number agrees and the product does not. The app refuses to decide — it flags
> the row and asks you.

## How identification works

Matching runs in three stages, and it stops at the first stage that produces evidence.

**Stage 0 — part/model code.** Codes are read from two places: the free text of
the description, and an auto-detected *Part No. / SKU / Code* column. Codes are
normalized so punctuation and case never matter:

| As written | Normalized |
| --- | --- |
| `A-1022`, `A1022` | `A1022` |
| `KBJ-1202` | `KBJ1202` |
| `23390-0L070` | `233900L070` |
| `208-54109` | `20854109` |

Sizes and dates are deliberately rejected: `M8` and `5L` are too short to
qualify, and a year-shaped segment (`2024`, `05`) is never read as part of a
code. If the code matches but the two descriptions share almost no content words
(overlap below 30%), the row becomes **CONFLICT** instead of CONFIRMED.

**Stage 1 — exact description.** Descriptions are normalized before comparison:
capitalization, punctuation and word order are ignored, dimension tuples are
unified (`27x40x6`, `27 × 40 × 6` and `27-40-6` all become `27x40x6`), and
auto-parts shorthand is standardized — `FRT`/`FR` → front, `RR` → rear,
`ASSY` → assembly, `LH` → left, `RH` → right, `hi-lux`/`hi lux` → hilux.
Left and right never collapse into each other.

**Stage 2 — fuzzy suggestions only.** Name similarity produces candidates, and
those candidates are marked **PROBABLE**. Fuzzy evidence never upgrades a row on
its own; a human (or Jev, or a manual pick) does that.

If no stage produces evidence, the row is **UNMATCHED**.

## How valuation works

For every identified item, the app collects **all** costing records linked to it.
Nothing is locked — one costing row may support several claim rows, and every
supported row is listed. For each identified claim line you get:

- **Records** — how many costing rows were found
- **Lowest** / **Highest** — the price range across those records
- **Wtd Avg** — quantity-weighted average when costing quantities exist, otherwise the simple mean
- **Unpriced** — records carrying a zero or unreadable price. They are **counted as identity evidence but excluded from the range**: a missing price is not a low price.

The claimed unit price is then positioned against that evidence:

| Flag | Meaning |
| --- | --- |
| **in-range** | Claimed price sits between lowest and highest. |
| **above** | Claimed above the highest costing record — potential overpayment. |
| **above-allowed** | Above the range but within the depreciation allowance (ACV) — explained, not a finding. |
| **below** | Claimed below the lowest costing record. |
| **unpriced** | No usable costing price on either side. |

**Overpayment exposure** sums (claimed − highest) across the rows flagged
`above`. Rows flagged `above-allowed` are excluded from it.

## Quick start

```bash
npm install

# create .env.local with the password you want to use on the login screen
echo "APP_PASSWORD=my-secret-password" > .env.local

npm run dev
# open http://localhost:3000
```

The app opens on a login screen; sign in with the password in `APP_PASSWORD`.

## How to use it

1. **Upload both files.** Drop File A (Ending Inventory) and File B (Costing file).
   The sheet, the header row (picked from rows 1–20, so title blocks and blank
   rows above the table are handled), the item-name column, the unit-price column
   and the quantity column are auto-detected; international header keywords are
   recognized and date columns are not mistaken for prices. A **Part No. / SKU /
   Code** column is auto-detected separately and used for Stage 0. Every
   dropdown can be overridden, and a preview shows the first rows.
2. **Pre-flight file health panel.** Before you run, each file gets a one-pass
   health check (`looks good` / `warnings` / `problems`) flagging blank-name
   rows, duplicate descriptions, unreadable prices (`N/A`, `TBA`, …), zero and
   negative prices, Excel dates stored as serial numbers in the price column,
   prices stored as text, and the detected item-code pattern. Each issue comes
   with sample rows and a one-line "what this means" hint.
3. **Run the comparison.** Matching runs **multi-core**: File A rows are chunked
   across Web Workers (one per CPU core) with live progress. The engine skips
   footer/total rows and rejects date-shaped prices.
4. **Review results.** Six cards across the top: five status counts for File A
   (they always sum to the File A row count) and three cards for File B (total
   costing rows, paired, unmatched). Five tabs:
   - **Claim Audit** — every File A row. Search with the `/` shortcut, sort any
     column, filter with the status chips, and filter by **Gap ± %**.
   - **Adjuster Ledger** — every File B row, paired or unmatched. This is where
     omitted items, duplicates and unexplained stock live. Unmatched rows have a
     **Find matches** button that reverse-searches File A; confirming a match
     promotes the claim row to CONFIRMED and re-collects its valuation evidence.
   - **Action List** — everything that is not CONFIRMED or STRONG, ready to work
     through. Bulk **Jev screening** is triggered here.
   - **Price Summary** — inventory totals in total cost (qty × unit price),
     variance between the two inventories, valuation-position counts
     (in-range / above / above-allowed / below / unpriced), overpayment exposure,
     a quantity check, duplicate claim lines, and unmatched costing lines.
   - **Settings** — thresholds, depreciation allowance, item-code stripping, Jev key.
5. **Item detail modal.** Clicking a row shows its linked costing records with
   the price range, every candidate with its similarity score and matched part
   code, and the row's notes. For PROBABLE and CONFLICT rows you can **Confirm
   this match** manually (status becomes CONFIRMED, method `manual`) or screen
   the pair with Jev.
6. **Dark mode.** The sun/moon toggle follows your system preference on first
   visit and remembers your choice.
7. **Export.** "Export Excel report" downloads the workbook described below.

## Settings

Three settings require **Apply & re-run comparison**; the depreciation allowance
applies instantly because it only changes how results are displayed.

| Setting | Default | Meaning |
| --- | --- | --- |
| Review floor | `60` | Fuzzy similarity (0–99) at or above which a candidate is kept as a PROBABLE suggestion. Below it, nothing is kept. |
| Reference gap tolerance (%) | `0` (Exact) | Informational band for the difference display and the Gap filter, 0–50 (step 0.5). Presets: Exact, ±5, ±10, ±15, ±20, ±25, ±50. **Identity never depends on price**, so this cannot change a status. |
| Item-code stripping | `auto` | How item codes are removed from names before the description is compared: auto-detect, none, first token, last token, or a custom regex. The resolved mode is shown after a run. Affects name comparison only — part codes are always extracted from the raw text. |
| Depreciation allowance (ACV mode) | `0` (Off) | Off / −5 / −10 / −15 / −20 / −30 / −50. A claim sitting above the whole costing range by at most this percentage is flagged `above-allowed` (explained) instead of `above` (potential overpayment), and is excluded from overpayment exposure. **Never changes an identity status.** |

Defaults live in `DEFAULT_SETTINGS` in `src/lib/types.ts`; the depreciation
allowance is display-layer state held in `src/app/page.tsx` and defaults to `0`.

> There is **no auto-accept setting**. Nothing is accepted on the strength of a
> name score alone. A part number, an exact description, or a person decides.

## Connecting Jev

Jev is TypeSafe AI's **"System One"** model, used as a second opinion on the rows
the engine deliberately refuses to decide.

1. In **Settings**, paste your TypeSafe API key. It is stored **only in your
   browser's localStorage** — never on the server.
2. Bulk screening (Action List) sends each **PROBABLE** and **CONFLICT** pair —
   the claim item name and the top candidate's description — through the app's
   `/api/jev` proxy, which forwards them to `https://api.typesafe.ai/v1/systemone`
   (model `jev-latest`) and **stores nothing**. The key travels per-request as a
   Bearer header; pairs are sent in small chunks with live progress. Only two
   text descriptions per pair leave the browser.
3. Jev answers with a probability ("noul"), mapped to a verdict:
   - probability ≥ 0.8 → **MATCH** — the claim row becomes CONFIRMED, method `jev`.
   - probability ≤ 0.2 → **NOT_MATCH** — the candidate is rejected.
   - In between → **UNCERTAIN** — the row stays in review for a human decision.

The app is fully functional **without** a Jev key — screening is an optional extra.

## Privacy stance

- Your spreadsheets are read with the browser's **File API** and are **never uploaded**. No request this app makes ever carries file data.
- Parsing, identity matching and valuation run **locally in a Web Worker** on your machine.
- Results live only in the current tab's memory. **A page refresh erases everything.**
- There is **no database** and nothing is stored server-side.
- The **only** outbound call in the entire app is Jev screening, and even that sends only two text descriptions per pair — nothing is stored or logged.
- The only things this app persists anywhere are your Jev API key and your theme choice, both in your own browser's localStorage.

## Excel export

"Export Excel report" builds a five-sheet workbook in the browser:

| Sheet | Contents |
| --- | --- |
| **Summary** | Run timestamp (UTC), file names, the five status counts, the exact settings used, and an *Identification & valuation model* block. |
| **Price Summary** | Σ claimed / Σ verified / net difference / total absolute difference, average and largest gap %, the five valuation-position counts, **overpayment exposure**, a per-status money table, and a *How to read this report* block. |
| **Full Audit** | Every File A row with its part codes, reference costing row, **Records / Lowest / Highest / Wtd Avg**, difference, gap %, score, method, status and notes. |
| **Action List** | Everything that is not CONFIRMED or STRONG, with the same columns. |
| **Adjuster Ledger** | Every File B row, its part code, quantities, unit price, total cost, and the claim rows it supports (`Paired → A12, A48` or `Unmatched`). |

Both Summary and Price Summary carry a **methodology block** with four notes:
the three-layer model; how valuation evidence is gathered and why no price is
auto-accepted; a documentary qualification on *Specific Identification* being
declared in the inventory but untraceable to a purchase cost without invoices,
purchase journals, stock/bin cards or the inventory subsidiary ledger; and the
treatment of zero-price costing lines.

Table sheets ship with autofilter, frozen headers, zebra striping and
`#,##0.00` money formats. Optional columns (**Claimed Qty / Assessed Qty**,
**Duplicate Rows**, **Jev Verdict**) appear only when the data exists.

## Known gaps

These are real and current — the app is not finished:

1. **The real workbooks have never been uploaded.** All testing to date has used generated dummy data. Every claim about real-file behaviour in this README is a design intent until the actual Ending Inventory and Costing files are run through it.
2. **Quantity (layer 2) is UI-only.** Quantity columns feed the totals, extended amounts and the Price Summary quantity check, but there is no independent quantity test — no row is flagged "quantity not verified".
3. **Accepted-cost selection is still adjuster-entered.** The app gathers and displays the valuation evidence; choosing the accepted cost remains a human decision made outside the tool.
4. **`scripts/` is stale.** The test scripts were written against the previous engine and still assert the old five statuses and a four-sheet workbook. They do not currently validate this build and need rewriting before they mean anything.

## Testing scripts

`scripts/` contains the old harness, kept for reference:

```bash
node scripts/test-engine.mjs        # engine unit + integration checks
node scripts/make-dummy-data.mjs    # regenerates the dummy corpus + answer key
node scripts/acceptance-check.mjs   # key totals + seeded spot rows
node scripts/verify-export.mjs      # rebuilds and checks the Excel report
node scripts/dark-sweep.mjs         # dark-mode sweep
```

These predate the three-layer rewrite — see *Known gaps* item 4 before trusting
any of them. The dummy workbooks in `public/testdata/` are likewise from the
previous model.

## Deploying to Vercel

```bash
npm i -g vercel
vercel login
vercel
```

Then set `APP_PASSWORD` in your Vercel project's environment variables (Project →
Settings → Environment Variables) and redeploy. Open the deployed URL on your
phone, log in, and verify a run end-to-end — the whole pipeline is client-side,
so a phone browser is a legitimate runtime, not just a viewer.

## Architecture map

```
src/
  app/
    page.tsx                  # app flow: upload → run → dashboard; owns state, wiring, export
    login/page.tsx            # password login screen
    api/auth/login|logout/    # password check → session cookie
    api/jev/route.ts          # stateless proxy to TypeSafe "System One"; stores nothing
  components/
    UploadScreen.tsx          # file drop, sheet/header/name/price/qty detection + overrides
                              #   + pre-flight health panel
    Dashboard.tsx             # status + costing cards; tabs; export; bulk Jev screening
    ResultsTable.tsx          # search ("/" shortcut), sort, status chips, Gap ± % filter
    ItemDetailModal.tsx       # valuation range, candidates, manual confirm, per-row Jev
    PriceSummary.tsx          # inventory totals, valuation-position counts, exposure,
                              #   quantity check, duplicates, unmatched costing lines
    AdjusterLedger.tsx        # every File B row, paired/unmatched, "Find matches" reverse search
    SettingsPanel.tsx         # review floor, reference gap tolerance, depreciation, code strip, Jev key
    StatusPill.tsx            # status badge + shared formatters
    ThemeToggle.tsx           # light/dark toggle (localStorage, system default)
  lib/
    types.ts                  # shared types, STATUS_LABELS, DEFAULT_SETTINGS
    normalize.ts              # cleanPrice, normalizeDescription, similarity, code stripping
    identity.ts               # layer 1: part-code / dimension / word extraction from descriptions
    matching.ts               # layer 1: the three-stage engine (code → exact → fuzzy)
    analysis.ts               # layer 3: valuation evidence, range/weighted average, flags,
                              #   overpayment exposure, reverse coverage
    parse.ts                  # workbook reading, header/column auto-detection, previews
    preflight.ts              # upload-time file health check
    runParallel.ts            # multi-core runner: chunks File A rows across Web Workers
    jev.ts                    # Jev client: localStorage key, chunked screening calls
    report-workbook.ts        # builds the 5-sheet Excel report
    export.ts                 # browser download of the report
  workers/
    match.worker.ts           # Web Worker that runs the engine on a chunk with progress messages
  proxy.ts                    # password gate: every route except /login and /api/auth requires the cookie
```

`ROBUSTNESS-NOTES.md` documents the real-world file messiness the engine tolerates
— wrong header rows, date-shaped prices, footer/total rows, stray codes,
full-width characters, international headers — and what to click when your files
misbehave. `HOW-IT-WORKS.md` is the plain-language version for reviewers.