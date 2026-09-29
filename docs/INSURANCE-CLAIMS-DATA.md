# Insurance Claims Data — Research for Price Verifier

*Context: Price Verifier compares File A (itemized inventory submitted by the CLAIMER) against File B (the same inventory as recorded by the ADJUSTER). Target scenario: commercial stock-loss claims — a hardware store, a motor-parts dealer, sacks of rice and similar stock — under burglary, fire, flood, and margin/loss-of-profit policies. This document grounds the app's columns, discrepancy model, and roadmap in real-world claims practice.*

---

## 1. Typical file shapes: what each side actually contains

The two files come from different document traditions:

- **File A (claimer)** descends from the **sworn proof of loss**. Standard-form proofs of loss require the insured to state, per item, the actual cash value, the amount of loss, and an *inventory of the property with quantity and cost*; the claimant's itemized schedule is expected to carry quantities, costs, values, and the amount claimed ([Property Insurance Coverage Law Blog](https://www.propertyinsurancecoveragelaw.com/blog/north-carolina-coverage-proof-of-loss-requirements), [IBC Claim Form 8 via RIMS](https://www.rims.org/docs/rimscanadalibraries/ibc-bac-claim-forms/claim-form-8-non-fire-proof-of-loss-20234f462379-376c-44b6-8778-5a8837299e29.pdf?sfvrsn=d9744366_3), [adviceonly.com glossary](https://adviceonly.com/glossary/proof-of-loss)).
- **File B (adjuster)** descends from the **scope-and-valuation report / surveyor's assessment** — a line-item estimate where each line carries a quantity, unit, unit price, and total ([Oceanpoint Claims glossary](https://oceanpoint.claims)), and which is meant to be compared line by line against the claim to flag missing items, low quantities, and pricing discrepancies ([insuranceclaimsinfo.com](https://insuranceclaimsinfo.com)).

### Column-by-column map

| Column | Claimer (A) | Adjuster (B) | Notes |
| --- | --- | --- | --- |
| Line / item no. | Yes | Yes | Used for cross-referencing in correspondence |
| Item description | Yes | Yes | Adjuster's wording is often terse/normalized ("cemento 40kg"); claimer uses invoice wording |
| Brand / make | Often | Often | Both sides, but substitution is a classic discrepancy (see §2) |
| Model / size / spec | Often | Often | Specs matter more than brand for hardware/parts (e.g., "10W-40, 4L") |
| Serial number | Only for appliances/machinery | Only if verified | Rare for bulk stock; exact-match candidate (§4) |
| Unit of measure (pcs/box/sack/kg/pc-set) | Yes | Yes | Frequently inconsistent between the two files |
| Quantity claimed | Yes | — | Claimer states stock lost |
| Quantity assessed / verified | — | Yes | Adjuster's counted or reconstructed quantity |
| Unit price claimed | Yes | — | Usually invoice/replacement price; sometimes retail |
| Unit price assessed | — | Yes | Adjuster's verified price (cost/trade basis, see §3) |
| Extended amount (qty × unit price) | Yes | Yes | The number both sides total up |
| % depreciation | — | Yes (ACV policies) | Adjuster applies age/condition deduction |
| Valuation basis (RCV / ACV / cost) | Sometimes stated | Usually stated | Drives expected price gaps (§3) |
| Salvage value | — | Yes (partial losses) | Deducted from loss; salvors inventory and sell damaged stock ([Swerling](https://swerling.com), [Adjusters International](https://www.adjustersinternational.com)) |
| Condition / age | Rarely | Yes (ACV basis) | Drives depreciation |
| Category / section grouping | Yes (by stock type) | Yes (by scope section) | Hardware→tools/paint/electrical; parts→per engine family; rice→per grade |
| Photo / exhibit reference | Occasionally | Yes | "Ex. 12" tags rows to photographs |
| Source doc reference (invoice/receipt) | Yes if available | Verified against books | Stock claims are assessed against books of account ([ICAI ch. 13](https://coursecontent.indusuni.ac.in/wp-content/uploads/sites/8/2020/03/chapter-13-insurance-claims-for-loss-of-stock-and-loss-of-profit1.pdf)) |
| Remarks / notes | Sometimes | Yes | Adjuster notes are where disputes live ("no receipts", "partially damaged", "not in purchase records") |

### Mini worked example (hardware/rice dealer burglary claim)

| Row | File A (claimer) | File B (adjuster) |
| --- | --- | --- |
| 1 | `Portland Cement 40kg — 200 sacks — ₱230 — ₱46,000` | `Cement 40kg — 180 sacks — ₱215 — ₱38,700 — remark: count per purchase records` |
| 2 | `Common nails 2" — 40 boxes — ₱180/box — ₱7,200` | `Nails 2in — 40 pcs — ₱8.50 — ₱340 — remark: unit = piece` |
| 3 | `Shell Helix HX7 4L — 24 — ₱1,450 — ₱34,800` | `Engine oil 4L (Helix HX3) — 24 — ₱980 — ₱23,520` |
| 4 | `Wellmade hammer 16oz — 10 — ₱350 — ₱3,500` | *(no row — no purchase record found)* |
| 5 | `Rice well-milled 50kg — 300 sacks — ₱2,400 — ₱720,000` | `Rice WM 50kg — 300 — ₱2,150 (cost) — ₱645,000 — 0% dep` |

Rows 1/3/5 illustrate qty inflation, brand substitution, and cost-vs-claim price; row 2 is a box-vs-piece UoM trap that description matching alone will score as a *huge* price mismatch unless UoM is understood; row 4 is a phantom candidate.

**Structural notes.** Both files typically have repeated header rows, category sub-headings mid-sheet, and subtotal lines the engine must skip. The adjuster file often ends with a settlement summary block (subtotal, depreciation, salvage, deductible, net payable). In South-Asian-style stock claims (rice sacks, hardware, motor parts), the adjuster/surveyor reconstructs stock from books (opening stock + purchases − cost of sales) and values it **at cost, not selling price**, less salvage, subject to an average/underinsurance clause ([Scribd: fire claim procedure](https://www.scribd.com/document/578458494/Fire-Insurance-Claim-FA-II1643715404), [ICAI ch. 13](https://coursecontent.indusuni.ac.in/wp-content/uploads/sites/8/2020/03/chapter-13-insurance-claims-for-loss-of-stock-and-loss-of-profit1.pdf)).

---

## 2. Discrepancy taxonomy for stock-loss claims

| # | Discrepancy | How it shows up when comparing two Excel files | Detectable with description match + numeric comparison? |
| --- | --- | --- | --- |
| 1 | **Quantity inflation** | Same description matches, `qtyA > qtyB` (e.g., 200 sacks vs 150 counted) | **High** — but only once qty columns are compared; price-only comparison shows nothing |
| 2 | **Price inflation** | Matched description, `priceA > priceB` beyond tolerance | **High** — this is the app's core check. Caveat: some gap is legitimate (§3) |
| 3 | **Retail-vs-cost overstatement** | Matched rows where `priceA` is a selling price and `priceB` is cost/trade; ratio ≈ store's markup, consistent across many rows | **Medium** — a *consistent directional ratio* across rows is the tell; detectable as a pattern, not per-row |
| 4 | **Phantom / fabricated items** | A row in A with no B candidate at all (NOT_FOUND). Especially high-value, generic descriptions ("assorted tools") | **Medium** — NOT_FOUND can be a matching failure too; generic descriptions inflate false NOT_FOUND. Serial/model/receipt columns would disambiguate |
| 5 | **Omitted items** (adjuster found more) | B row consumed by no A row, or A row matched to the wrong B. Also duplicate-looking B rows left unmatched | **Low–Medium** — needs reverse-direction (B→A) coverage; NOT_FOUND is currently only computed A→B |
| 6 | **Duplicate line items** | Same description (and qty/price) appears twice in A, matched to one B row twice or to two B rows | **Medium** — detectable within-file by grouping normalized descriptions in one file; current engine treats each A row independently |
| 7 | **Unit-of-measure mix-ups** (box vs piece) | Prices differ by a "clean" factor (×10, ×12, ×50) while descriptions match; or qty matches but price is 1/box-count of expectation | **Medium** — heuristic: ratio ≈ whole-number pack size. Needs UoM awareness to confirm |
| 8 | **Brand/model substitution** | Fuzzy match succeeds but brand tokens differ ("Shell Helix" claimed vs "generic" assessed); or premium-token claim matched to value-token B row | **Medium** — token-level brand comparison after matching; Jev screening helps flag these pairs |
| 9 | **Depreciation disagreement** | Matched rows where `priceB ≈ priceA × (1 − d)` for a consistent d, or B has a % depreciation column | **Low** with prices alone; **High** if the B file's depreciation column is parsed |
| 10 | **Old-stock pricing vs replacement cost** | `priceA` (current replacement) > `priceB` (book/old invoice price), one-directional, moderate % | **Low** — indistinguishable from #3 per-row; needs policy valuation basis as context |

**Fraud-screening context.** NICB's *Indicators of Property Fraud* lists classic red flags directly relevant here: theft/looting claims with vague or unverifiable inventories, missing receipts/purchase records, and schedules that don't match the physical scene ([NICB indicators PDF](https://www.nicb.org/media/1871/download)); fraud literature adds "loss claim contains no items of sentimental value / all items conveniently claimed" ([Zalma](https://www.linkedin.com/pulse/red-flags-insurance-fraud-barry-zalma)). The taxonomy above is the quantified, per-row version of those flags — the app's output doubles as an SIU screening artifact.

---

## 3. Valuation basics: RCV vs ACV, and why mismatches are expected

- **RCV (replacement cost value)** = what a new equivalent item costs today, no deduction for wear.
- **ACV (actual cash value)** = "computed by subtracting depreciation from replacement cost"; a standard formulation is **ACV = RCV × (remaining useful life ÷ total useful life)** ([Wikipedia: Actual cash value](https://en.wikipedia.org/wiki/Actual_cash_value)). Adjusters base depreciation on age and condition, and the gap can be very large for old stock ([BrokerPro](https://brokerproinsurance.com)).
- Under an RCV policy the ACV is often paid first, with the **recoverable depreciation** released on proof of replacement ([Avner Gat](https://www.avnergat.com)) — so even one file can contain two different unit prices per row.
- Policies mix bases per item class: buildings often RCV, contents often ACV, special items agreed/fixed value ([Wikipedia](https://en.wikipedia.org/wiki/Actual_cash_value)). The market has broadly shifted from ACV toward RCV policies ([J.S. Held](https://www.jsheld.com)).
- **Stock-specific wrinkle:** for unsold trading stock, the indemnity principle values goods at **cost, not selling price** — no profit element is allowed in the loss, and average/underinsurance clauses can scale the whole claim down; the claimant's books are the primary evidence ([ICAI ch. 13](https://coursecontent.indusuni.ac.in/wp-content/uploads/sites/8/2020/03/chapter-13-insurance-claims-for-loss-of-stock-and-loss-of-profit1.pdf), [Dumkal College notes](https://dumkalcollege.in/uploads/notice/dept_estore_31-01-2025_1738334773369.pdf)). Loss-of-profit (margin) claims are computed separately as reduction in turnover × rate of gross profit ([Connaught Law](https://connaughtlaw.com)).

**Implication for the app.** The claimer file tends to carry *replacement/current retail* prices; the adjuster file tends to carry *cost, trade, or depreciated* prices. Therefore **raw unit-price mismatches are EXPECTED for some rows and are not, by themselves, evidence of error or fraud**. Concretely:

- Show the **direction** of every price difference ("verified below claim" vs "verified above claim"), not just the magnitude. An adjuster valuing above the claim is a different event from shaving below it.
- Offer a **depreciation-aware / valuation-basis mode**: if the B file has a % depreciation column (or a uniform basis is chosen), compare `priceA` against `priceB ÷ (1 − d)` or compare extended amounts after applying d, so systematic ACV gaps don't flood the Action List.
- The tolerance setting should be framed as "expected valuation drift" rather than "allowed error", and large but *consistent-ratio* differences across many rows should be surfaced as a basis mismatch, not row-by-row noise.

---

## 4. Mapping to the app: what exists, what to build

### Already handled

| Capability | Status |
| --- | --- |
| Description matching: exact + fuzzy, motor-parts-aware, manual pick, optional Jev screening | Done (`src/lib/matching.ts`) |
| Unit-price comparison with % tolerance, per-row difference | Done (`Settings.priceTolerance`) |
| Status model MATCH / MISMATCH / MULTIPLE / NEEDS_REVIEW / NOT_FOUND | Done (`src/lib/types.ts`) |
| Claim accuracy summary + 4-sheet Excel export (Summary / Price Summary / Full Audit / Action List) | Done (`src/lib/report-workbook.ts`) |
| Quantity columns on File A and File B | In flight (being added to parse/matching) |
| Column auto-detection for name + price, header-row detection | Done (`src/lib/parse.ts`) |

### Which app status points at which discrepancy

| App status | Most likely taxonomy causes | Follow-up |
| --- | --- | --- |
| MATCH | Clean agreement; or valuation basis happens to align | None |
| MISMATCH (price only) | #2 price inflation, #3 retail-vs-cost, #7 UoM mix-up, #9 depreciation, #10 old-stock price | Check qty, UoM, and ratio pattern before judging |
| MISMATCH (once qty compared) | #1 quantity inflation | Compare extended amounts |
| MULTIPLE | #6 duplicates in B, or generic descriptions matching several B rows | Manual pick; then look for duplicate A rows |
| NEEDS_REVIEW | #8 brand/model substitution (partial token overlap) | Inspect brand tokens; Jev screen |
| NOT_FOUND | #4 phantom item — or matching failure on generic/renamed items | Verify against receipts; check reverse direction |

### Prioritized backlog for the insurance use case

| Priority | Feature | Value | Effort | Why |
| --- | --- | --- | --- | --- |
| 1 | **Extended-amount comparison** (qty × price per row, compare claimed vs assessed extended total, per-row delta and %) | High | M | Quantity inflation (#1) and the headline number both sides argue about live in the extended amount, not the unit price |
| 2 | **Directional framing + claim-side totals** (grand totals: claimed vs assessed vs variance; label each price gap "verified below claim" / "above claim") | High | S | Matches adjuster language; makes expected ACV gaps legible instead of alarming (§3) |
| 3 | **Depreciation-aware comparison mode** (parse % depreciation / valuation-basis column; compare after applying d; or uniform ACV/RCV toggle) | High | M | Prevents systematic legitimate gaps from flooding the Action List (§3) |
| 4 | **UoM normalization** (detect pcs/box/sack/kg; flag matched rows whose price ratio equals a plausible pack factor; UoM column in mapping UI) | High | M | Unit mix-ups (#7) are the most common honest error and a classic inflation trick |
| 5 | **Reverse coverage: B rows not matched to any A row** (omitted items #5) | Med | S | Closes the "adjuster found more" blind spot; cheap once B-matching state exists |
| 6 | **Duplicate-line detection within a file** (same normalized description+qty+price repeated) | Med | S | Directly flags duplicate claiming (#6) and pad-lines |
| 7 | **Serial/model/brand token comparison after matching** (boost exact serial/model hits to auto-MATCH; flag brand-token swaps) | Med | S | Sharpens #8 and reduces false NOT_FOUND/MULTIPLE |
| 8 | **Category/section rollups + per-section subtotals** (respect mid-sheet group headings; subtotal variance per section in export) | Med | M | Both real files are sectioned; subtotals are how adjusters negotiate section by section |
| 9 | **Claim-form-style export layout** (Proof-of-Loss sheet: description, qty claimed/assessed, price claimed/assessed, extended both, variance, % variance, depreciation, remarks) | Med | M | Lets the workbook be pasted into settlement correspondence |
| 10 | **Price-band tolerance** (absolute floor + % for cheap items; or sliding tolerance) | Med | S | Flat % tolerance over-flags cheap hardware items and under-flags big-ticket ones |
| 11 | **Salvage & photo/exhibit reference columns** (pass-through display + export) | Low | S | Round-trips the adjuster's real columns; no logic needed |
| 12 | **Consistent-ratio pattern detector** (many matched rows with similar price ratio ⇒ "possible retail-vs-cost or depreciation basis mismatch" banner) | Low | M | Converts taxonomy #3/#9/#10 from noise into one actionable finding |

---

## Sources

- [Property Insurance Coverage Law Blog — proof of loss requirements](https://www.propertyinsurancecoveragelaw.com/blog/north-carolina-coverage-proof-of-loss-requirements)
- [IBC Claim Form 8, Proof of Loss (RIMS library)](https://www.rims.org/docs/rimscanadalibraries/ibc-bac-claim-forms/claim-form-8-non-fire-proof-of-loss-20234f462379-376c-44b6-8778-5a8837299e29.pdf?sfvrsn=d9744366_3)
- [adviceonly.com — Proof of Loss glossary](https://adviceonly.com/glossary/proof-of-loss)
- [Southernloss — Denial of claims and rejection of proofs of loss](https://southernloss.com/denial-of-claims-and-rejection-of-proofs-of-loss)
- [Oceanpoint Claims — Line-item estimate glossary](https://oceanpoint.claims)
- [insuranceclaimsinfo.com — How to challenge an Xactimate estimate line by line](https://insuranceclaimsinfo.com)
- [Wikipedia — Actual cash value](https://en.wikipedia.org/wiki/Actual_cash_value)
- [BrokerPro Insurance — ACV vs RCV on commercial property](https://brokerproinsurance.com)
- [Avner Gat — recoverable depreciation](https://www.avnergat.com)
- [J.S. Held — ACV-to-RCV market shift](https://www.jsheld.com)
- [NICB — Indicators of Property Fraud (PDF)](https://www.nicb.org/media/1871/download)
- [Barry Zalma — Red flags of insurance fraud](https://www.linkedin.com/pulse/red-flags-insurance-fraud-barry-zalma)
- [Swerling — What a salvor does in the claims process](https://swerling.com)
- [Adjusters International — Salvage: undamaged and partially damaged property](https://www.adjustersinternational.com)
- [ICAI study material ch. 13 — Insurance claims for loss of stock and loss of profit](https://coursecontent.indusuni.ac.in/wp-content/uploads/sites/8/2020/03/chapter-13-insurance-claims-for-loss-of-stock-and-loss-of-profit1.pdf)
- [Dumkal College — Loss of stock and loss of profit claims](https://dumkalcollege.in/uploads/notice/dept_estore_31-01-2025_1738334773369.pdf)
- [Scribd — Fire insurance claim procedures (average clause, salvage)](https://www.scribd.com/document/578458494/Fire-Insurance-Claim-FA-II1643715404)
- [Indian Kanoon — Gautam Solar vs Oriental Insurance (surveyor stock assessment)](https://indiankanoon.org/doc/125707387/)
- [Connaught Law — Business interruption / loss of gross profit](https://connaughtlaw.com)
- [Allstate — proof of ownership / home inventory guidance](https://www.allstate.com)
- [United Policyholders — Home inventory and contents claim tips](https://uphelp.org)
