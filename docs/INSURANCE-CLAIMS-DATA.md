# Insurance Claims Data — Research for Price Verifier

*Context: Price Verifier reconciles **File A — the insured's Ending Inventory** (the
claim) against **File B — the adjuster's Costing file** for commercial stock-loss
claims — a hardware store, a motor-parts dealer, sacks of rice and similar stock —
under burglary, fire and flood policies. This document grounds the app's column
mapping, its three-layer reconciliation model and its roadmap in real claims
practice.*

> **Status note.** The real Ending Inventory and Costing workbooks have **not** been
> uploaded yet. Everything in §2–§5 describes the model the app implements and the
> claims practice it is grounded in; the behaviour against the actual files is
> unverified until they are run through it.

---

## 1. The two files: what each side actually contains

The two files come from different document traditions, and that is the root of
most of the friction between them.

- **File A (Ending Inventory)** descends from the **sworn proof of loss**. Standard-form proofs of loss require the insured to state, per item, the actual cash value, the amount of loss, and an *inventory of the property with quantity and cost*; the claimant's itemized schedule is expected to carry quantities, costs, values, and the amount claimed ([Property Insurance Coverage Law Blog](https://www.propertyinsurancecoveragelaw.com/blog/north-carolina-coverage-proof-of-loss-requirements), [IBC Claim Form 8 via RIMS](https://www.rims.org/docs/rimscanadalibraries/ibc-bac-claim-forms/claim-form-8-non-fire-proof-of-loss-20234f462379-376c-44b6-8778-5a8837299e29.pdf?sfvrsn=d9744366_3), [adviceonly.com glossary](https://adviceonly.com/glossary/proof-of-loss)). In warehouse practice this is typically a stock report taken at close of business on the date of loss — an "Ending Inventory" — carrying the insured's own item codes, quantities and unit values.
- **File B (Costing file)** descends from the **scope-and-valuation report / surveyor's assessment** — a line-item estimate where each line carries a quantity, unit, unit price, and total ([Oceanpoint Claims glossary](https://oceanpoint.claims)), meant to be compared line by line against the claim to flag missing items, low quantities, and pricing discrepancies ([insuranceclaimsinfo.com](https://insuranceclaimsinfo.com)). It is frequently produced from a parts catalogue, which is why it carries **manufacturer part numbers** — the single most reliable identity signal in auto-parts and hardware stock.

### Column-by-column map

| Column | Ending Inventory (A) | Costing file (B) | Why it matters |
| --- | --- | --- | --- |
| Line / item no. | Yes | Yes | Cross-referencing in correspondence; the app keeps both row numbers on every result |
| **Part no. / model / SKU** | Sometimes | **Usually** | The primary identity signal. Read from the column *and* from free text |
| Item description | Yes — invoice/catalogue wording | Yes — terse, normalized | The insured says "Air Filter 23390-0L070"; the adjuster says "23390-0L070 Fuel Filter, Hi-Lux/Innova '16" |
| Brand / make | Often | Often | Substitution is a classic discrepancy — and the usual explanation for a CONFLICT row |
| Model / size / spec | Often | Often | Specs matter more than brand for hardware/parts ("10W-40, 4L", "27x40x6") |
| **Side / position** (LH/RH, FRT/RR) | Often | Often | A left-hand part is not a right-hand part. The normalizer must preserve this distinction |
| Serial number | Only for appliances/machinery | Only if verified | Rare for bulk stock; a candidate for exact-match identity |
| Unit of measure (pcs/box/sack/kg/pc-set) | Yes | Yes | Frequently inconsistent between the two files |
| Quantity claimed | Yes | — | Insured states stock lost |
| Quantity assessed | — | Yes | Adjuster's counted or reconstructed quantity |
| Unit price claimed | Yes | — | Usually invoice/replacement price; sometimes retail |
| Unit price assessed | — | Yes | Adjuster's verified price (cost/trade basis, see §4) |
| Extended amount (qty × unit price) | Yes | Yes | The number both sides total up |
| % depreciation | Sometimes (declared basis) | Yes (ACV policies) | Drives expected price gaps |
| Valuation basis (RCV / ACV / cost) | Sometimes stated | Usually stated | The root cause of most legitimate gaps |
| **Costing method declared** (e.g. Specific Identification) | Sometimes | — | See §5 — a declaration without tracing evidence is not proof |
| Salvage value | — | Yes (partial losses) | Deducted from loss; salvors inventory and sell damaged stock ([Swerling](https://swerling.com), [Adjusters International](https://www.adjustersinternational.com)) |
| Condition / age | Rarely | Yes (ACV basis) | Drives depreciation |
| Category / section grouping | Yes (by stock type) | Yes (by scope section) | Hardware→tools/paint/electrical; parts→per engine family; rice→per grade |
| Photo / exhibit reference | Occasionally | Yes | "Ex. 12" tags rows to photographs |
| Source doc reference (invoice/receipt) | Yes if available | Verified against books | Stock claims are assessed against books of account ([ICAI ch. 13](https://coursecontent.indusuni.ac.in/wp-content/uploads/sites/8/2020/03/chapter-13-insurance-claims-for-loss-of-stock-and-loss-of-profit1.pdf)) |
| Remarks / notes | Sometimes | Yes | Adjuster notes are where disputes live ("no receipts", "partially damaged", "not in purchase records") |

### Mini worked example (motor-parts warehouse, burglary claim)

| Row | Ending Inventory (A) | Costing file (B) |
| --- | --- | --- |
| 1 | `AIR FILTER 23390-0L070 — 12 — ₱1,850 — ₱22,200` | `23390-0L070 Air Filter, Hi-Lux/Innova '16 — 12 — ₱1,720` |
| 2 | `23390-0L070 — 4 — ₱1,850 — ₱7,400` | `23390-0L070 Fuel Filter, Hi-Lux/Innova '16 — 4 — ₱1,640` |
| 3 | `FRT BRK PAD SET` — 20 — ₱2,300 | `Brake Pad Set, Front` — 20 — ₱2,180 (ACV −5%) |
| 4 | `BRK PAD SET RH` — 10 — ₱2,300 | *(no row — no purchase record found)* |
| 5 | `OIL FILTER TOYOTA` — 30 — ₱650 | `Engine Oil Filter Toyota` — 24 — ₱620 |
| 6 | `SEAL 27x40x6` — 100 — ₱180 | `Seal 27-40-6` — 100 — ₱0 — *no price quoted* |

Row 2 is the canonical **conflict**: the insured called 23390-0L070 an air filter, the costing file calls it a fuel filter. Same part number, different product — the app must ask, not guess. Row 3 shows abbreviation normalization (`FRT` → front) and an expected ACV gap. Row 5 is a probable identity match with a quantity difference the adjuster must explain. Row 6 is an unpriced costing line: real identity evidence, but it must be excluded from any price range.

**Structural notes.** Both files typically have repeated header rows, category sub-headings mid-sheet, and subtotal lines the engine must skip. The costing file often ends with a settlement summary block (subtotal, depreciation, salvage, deductible, net payable). In South-Asian-style stock claims (rice sacks, hardware, motor parts), the adjuster/surveyor reconstructs stock from books (opening stock + purchases − cost of sales) and values it **at cost, not selling price**, less salvage, subject to an average/underinsurance clause ([Scribd: fire claim procedure](https://www.scribd.com/document/578458494/Fire-Insurance-Claim-FA-II1643715404), [ICAI ch. 13](https://coursecontent.indusuni.ac.in/wp-content/uploads/sites/8/2020/03/chapter-13-insurance-claims-for-loss-of-stock-and-loss-of-profit1.pdf)).

---

## 2. Why three layers, and not one

The obvious design — match the two files by name, then compare prices — fails on
stock claims for one structural reason: **identity and value are independent, and
each one has its own failure modes.**

- Identity fails on *plurals*: "WIPER BLADE 24\"" vs "Wiper Blade 24 inch" is one item, not two. Part numbers settle it.
- Identity fails on *homonyms*: one part number can appear in two catalogues with different product names. This is a **contradiction in the source documents**, not a matching bug.
- Value fails on *basis*: RCV claim vs ACV costing is a legitimate gap, and it will be present on every single row.
- Value fails on *coverage*: the adjuster may quote several lines for one item, or quote one line that supports several claim rows. Picking a single "matched" price throws away evidence.

So the app runs three independent tests and reports them separately:

| Layer | Question | Method | Never uses |
| --- | --- | --- | --- |
| 1. Identification | Is it the same item? | Part/model code → exact normalized description → fuzzy suggestion | **Price** |
| 2. Quantity | How many were lost? | Quantity columns as supplied; totals and extended amounts | Price |
| 3. Valuation | What unit cost is allowed? | Full range of linked costing records | Identity |

**Price is never an identity criterion.** This is the single most important design
decision in the app, and it is what makes the output defensible: an adjuster can
never be accused of a finding that rests on price alone.

---

## 3. Discrepancy taxonomy, mapped to the current status model

| # | Discrepancy | How it shows up | App status / flag | Detectable? |
| --- | --- | --- | --- | --- |
| 1 | **Quantity inflation** | Same item identified, `qtyA > qtyB` (30 claimed vs 24 counted) | Reported on Price Summary; **no row-level flag yet** | **Partial** — quantities are mapped and totalled, but layer 2 has no independent test |
| 2 | **Price inflation** | Identified item whose claimed unit price sits above the whole costing range | Valuation flag `above` | **High** — this is the core check. Caveat: legitimate under ACV (§4) |
| 3 | **Retail-vs-cost overstatement** | Matched rows where claimed price is a selling price and assessed is cost/trade; ratio ≈ the store's markup, consistent across many rows | Surface-level: many `above` rows | **Low per-row, Medium as a pattern** — detectable across rows, not on one |
| 4 | **Phantom / fabricated items** | An inventory row with no identity evidence anywhere in the costing file | **UNMATCHED** | **Medium** — also a matching failure on generic descriptions ("assorted tools"). Part numbers disambiguate |
| 5 | **Omitted items** (adjuster found more) | Costing rows no identified claim row references | **Adjuster Ledger → Unmatched** | **High** — reverse coverage is a first-class view |
| 6 | **Duplicate line items** | Identical descriptions on several inventory rows; or a costing row supporting several claim rows | **DUP** badge on the row; `Paired → A12, A48` in the ledger | **High** — duplicates are detected within File A and multi-support is explicit by design |
| 7 | **Unit-of-measure mix-ups** (box vs piece) | Prices differ by a clean factor (×10, ×12, ×50) while descriptions match | Not flagged as such — surfaces as a large `above` gap | **Low–Medium** — ratio ≈ pack size is a heuristic; needs UoM awareness |
| 8 | **Brand/model substitution** | Part number matches but the descriptions name different products — the inventory's "air filter" is the costing file's "fuel filter" | **CONFLICT** | **High** — this is exactly what the conflict test exists for |
| 9 | **Depreciation disagreement** | Assessed ≈ claimed × (1 − d) for a consistent d, or the costing file carries a depreciation column | Valuation flag `above-allowed` when within the allowance | **High** with the allowance set; the allowance is a display-layer control |
| 10 | **Old-stock pricing vs replacement cost** | Claimed price (current replacement) > assessed (book/old invoice), one-directional | `above`, then reclassified by the allowance | **Low per-row** — indistinguishable from #3 without the policy valuation basis |
| 11 | **Catalogue error (same product, two names)** | One part number described two ways in the two files | **STRONG** if the descriptions normalize equal; otherwise **PROBABLE** | **High** — description normalization absorbs most of these |
| 12 | **Unpriced costing lines** | A costing row identifies the item but carries no price | Valuation flag `unpriced`; counted, **excluded from the range** | **High** — and deliberately non-alarming: a missing price is not a low price |

### Which status points at which discrepancy

| App status | Most likely causes | Follow-up |
| --- | --- | --- |
| CONFIRMED | Clean agreement on part number | None — go to the valuation flag |
| STRONG | Clean agreement on description | None — go to the valuation flag |
| PROBABLE | #11 catalogue variance, #7 UoM wording, renamed generic items | Human confirmation or Jev screening |
| CONFLICT | #8 brand/model substitution, or a catalogue error | **Query the insured**, or the supplier about the catalogue entry |
| UNMATCHED | #4 phantom item, or a matching failure on generic/renamed stock | Verify against receipts; check the reverse direction in the ledger |

### Valuation flags

| Flag | Reading |
| --- | --- |
| in-range | Claimed price sits inside the lowest–highest costing range |
| above | Claimed above every costing record — potential overpayment |
| above-allowed | Above the range but within the depreciation allowance — expected, not a finding |
| below | Claimed below every costing record — usually in the insured's favour |
| unpriced | No usable costing price on either side |

**Overpayment exposure** = Σ (claimed − highest) across `above` rows only.
`above-allowed` rows are excluded, because the allowance exists precisely to stop
a systematic, policy-correct depreciation from being reported as a finding.

---

## 4. Valuation basics: RCV vs ACV, and why gaps are expected

- **RCV (replacement cost value)** = what a new equivalent item costs today, no deduction for wear.
- **ACV (actual cash value)** = "computed by subtracting depreciation from replacement cost"; a standard formulation is **ACV = RCV × (remaining useful life ÷ total useful life)** ([Wikipedia: Actual cash value](https://en.wikipedia.org/wiki/Actual_cash_value)). Adjusters base depreciation on age and condition, and the gap can be very large for old stock ([BrokerPro](https://brokerproinsurance.com)).
- Under an RCV policy the ACV is often paid first, with the **recoverable depreciation** released on proof of replacement ([Avner Gat](https://www.avnergat.com)) — so even one file can carry two unit prices per row.
- Policies mix bases per item class: buildings often RCV, contents often ACV, special items agreed/fixed value ([Wikipedia](https://en.wikipedia.org/wiki/Actual_cash_value)). The market has broadly shifted from ACV toward RCV policies ([J.S. Held](https://www.jsheld.com)).
- **Stock-specific wrinkle:** for unsold trading stock, the indemnity principle values goods at **cost, not selling price** — no profit element is allowed in the loss, and average/underinsurance clauses can scale the whole claim down; the claimant's books are the primary evidence ([ICAI ch. 13](https://coursecontent.indusuni.ac.in/wp-content/uploads/sites/8/2020/03/chapter-13-insurance-claims-for-loss-of-stock-and-loss-of-profit1.pdf), [Dumkal College notes](https://dumkalcollege.in/uploads/notice/dept_estore_31-01-2025_1738334773369.pdf)). Loss-of-profit (margin) claims are computed separately as reduction in turnover × rate of gross profit ([Connaught Law](https://connaughtlaw.com)).

**Implication for the app.** The inventory tends to carry *replacement/current
retail* prices; the costing file carries *cost, trade, or depreciated* prices.
Therefore **raw unit-price gaps are expected on many rows and are not, by
themselves, evidence of error or fraud.** Three design consequences:

1. The report shows the **evidence**, not a verdict: record count, lowest, highest and a quantity-weighted average for every identified item. An adjuster sets the accepted cost on that documented basis.
2. **No price is auto-accepted.** There is no tolerance setting that turns a difference into a match — identity and value are different tests.
3. The **depreciation allowance** reclassifies `above` → `above-allowed` so that a policy-correct, uniform depreciation does not flood the work list. It changes nothing about identity.

---

## 5. The documentary qualification: "Specific Identification"

Stock policies are often written on a **specific identification** basis: each claimed
item is individually identified and valued at its own actual purchase cost, rather
than at an average or category cost.

The practical difficulty: an Ending Inventory workbook that declares specific
identification carries **no lot numbers, item codes with cost history, or
purchase-date identifiers**. A description and a unit price are not a trace. To
verify a specific-identification claim you need at least one of:

- purchase invoices / receipts for the claimed units
- the purchase journal for the period
- stock or bin cards showing the units flowing into that bin
- receiving reports for the goods
- the inventory subsidiary ledger carrying per-item cost

This is why the Excel export carries a standing methodology note: the declaration
of a costing method in the inventory is recorded, but it is **not treated as proof
of that method**. The app does not adjudicate costing basis — it surfaces the
evidence and the qualification so the reader knows what has and has not been
substantiated.

---

## 6. Mapping to the app: what exists, what is missing

### Built

| Capability | Where |
| --- | --- |
| Part/model code extraction from free text and from a Part No. / SKU column; date and size rejection; dimension-tuple unification | `src/lib/identity.ts` |
| Three-stage identification (code → exact description → fuzzy suggestions) | `src/lib/matching.ts` |
| Five statuses: CONFIRMED / STRONG / PROBABLE / CONFLICT / UNMATCHED | `src/lib/types.ts` |
| Conflict detection: shared part number, disagreeing product (overlap < 30%) | `src/lib/matching.ts` |
| Valuation evidence: all linked costing records, count / lowest / highest / qty-weighted average, zero-price exclusion | `src/lib/analysis.ts` |
| Five valuation flags + depreciation allowance (ACV) + overpayment exposure | `src/lib/analysis.ts` |
| Manual confirmation (CONFIRMED, method `manual`) and Jev screening of PROBABLE / CONFLICT | `src/app/page.tsx`, `src/lib/jev.ts` |
| Reverse coverage: every costing row listed, `Paired → A12, A48`, "Find matches" on unmatched rows | `src/components/AdjusterLedger.tsx` |
| Five-sheet Excel export with methodology block on Summary and Price Summary | `src/lib/report-workbook.ts` |

### Missing or partial

| Capability | State |
| --- | --- |
| **Quantity test (layer 2)** | **Partial.** Quantities are detected, totalled and shown as extended amounts and a quantity check on Price Summary. There is no independent quantity test and no per-row quantity flag |
| **Accepted-cost selection** | **Manual by design.** The app presents the evidence; the accepted cost is entered by the adjuster |
| **Real-file validation** | **None.** The actual Ending Inventory and Costing workbooks have not been uploaded; all testing uses generated dummy data |
| **UoM normalization / pack-factor detection** | Not built (taxonomy #7) |
| **Consistent-ratio pattern detection** across many rows | Not built (taxonomy #3, #10 as a pattern) |
| **Category/section rollups** with per-section subtotals | Not built — both real files are sectioned |
| **Salvage / photo-exhibit / depreciation-column pass-through** | Not built |
| **Duplicate costing lines within File B** | Not detected (only File A duplicates are) |

### Prioritized backlog

| Priority | Feature | Value | Effort | Why |
| --- | --- | --- | --- | --- |
| 1 | **Run the real workbooks** end to end and record what breaks | Critical | S | Nothing else in this table can be prioritized honestly until the real files are parsed |
| 2 | **Independent quantity test (layer 2)** — flag rows where claimed ≠ verified units | High | M | Quantity inflation (#1) is the largest single discrepancy class and currently has no per-row finding |
| 3 | **UoM normalization** — detect pcs/box/sack/kg; flag matched rows whose price ratio equals a plausible pack factor | High | M | Box-vs-piece is the most common honest error and a classic inflation trick |
| 4 | **Duplicate costing lines within File B** | Med | S | Completes the duplicate picture; today only File A duplicates are detected |
| 5 | **Consistent-ratio pattern detector** — many rows with a similar claimed/assessed ratio ⇒ "possible retail-vs-cost or depreciation basis mismatch" banner | Med | M | Converts #3/#9/#10 from row-level noise into one actionable finding |
| 6 | **Category/section rollups** with per-section subtotals | Med | M | Both real files are sectioned; subtotals are how adjusters negotiate section by section |
| 7 | **Adjuster-led costing-basis capture** — record the accepted cost and its basis per item against the collected evidence | Med | M | Closes the loop between the valuation layer and the settlement letter |
| 8 | **Salvage / photo-exhibit / depreciation-column pass-through** | Low | S | Round-trips the costing file's real columns; no logic needed |
| 9 | **Price-band tolerance** (absolute floor + % for cheap items) | Low | S | A flat % over-flags cheap hardware and under-flags big-ticket lines |

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