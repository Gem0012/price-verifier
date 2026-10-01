# How Price Verifier Works

*A plain-language guide for anyone reviewing a claim — no technical background needed.*

---

## The big picture

Two people described the same inventory and each produced their own list:

- **File A — the claim inventory** (what the claimer says was lost and what it's worth)
- **File B — the adjuster inventory** (what the adjuster counted and valued)

Price Verifier lines the two lists up against each other and answers three
questions for every item:

1. **Is it on both lists?**
2. **Do the prices agree?**
3. **Is anything on one list missing from the other?**

Nothing on either list is ever thrown away. Every row of both files stays
visible from the moment you upload to the moment you export.

---

## How the matching works

For every item on the **claim list**, the app reads the **entire adjuster
list** looking for the same item described differently:

- *"Finishing Nail 2 inch Galvanized"* on one list might be
  *"2in galv. finish nail"* on the other.
- CAPITALS, punctuation, and word order are all ignored when comparing.

**Names are matched first. Only after the app decides which two rows are the
same item does it compare the prices** on that pair. A price check is only
meaningful once you know you're looking at the same item.

Numbers are treated as identity: a **6202 bearing is not a 6203 bearing**, and
a **1-gallon can is not a 4-gallon pail**. Similar-looking items with
different measurements are different products, and the app deliberately
refuses to auto-match them.

---

## The five verdicts a claim item can receive

| Verdict | Plain meaning | What happens next |
|---|---|---|
| **Match** | Same item on both lists **and** the prices agree (within your tolerance) | Nothing — healthy line |
| **Mismatch** | Same item, but the prices **disagree** | This is a finding — the heart of the audit |
| **Multiple matches** | Two or more adjuster lines fit this claim item equally well | The app refuses to guess — you pick the right one |
| **Needs review** | Best candidate is only 60–89% alike — close but not convincing | Jev (the AI) or you confirms "same item?" |
| **Not found** | Nothing on the adjuster's list shares its words | Possible phantom item — claim lists something the adjuster never saw |

### Worked examples (real scores from the app)

| Claim says | Adjuster says | Score | Verdict | Why |
|---|---|---|---|---|
| Common Wire Nail 2 inch Galvanized — **₱50** | common wire nail 2 inch galvanized — **₱72** | 100 | **Mismatch** | Identical name, but ₱72 vs ₱50 is a real price gap — the finding |
| Oil Filter Toyota | oil filter toyota **hilux** | 91 | **Match** | An extra word is tolerated — clearly the same filter |
| Ball Bearing 6202 ZZ | 6202 zz ball bearing **SKF** | 86 | **Needs review** | Same part, reordered + brand added — confirm, then it's a match |
| Finishing Nail 2 inch Galvanized | 2in galv. finish nail | 65 | **Needs review** | Heavily reworded — Jev answers "same item? yes" and it becomes verified |
| Ball Bearing **6202** ZZ | Ball Bearing **6203** ZZ | 44 | **Not found** | One digit off = a different part. The app pushes this down so it can never false-match |
| Latex Paint **1 gallon** | White latex paint **4 gallon** | 42 | **Not found** | Same paint, different size = different product |
| Safety Glove Leather | PVC Pipe 3 inch | 0 | **Not found** | Nothing in common |

A **Needs review** is not a failure — it's the app saying *"human, confirm this
pair."* Jev screens these in bulk (or you confirm each one); once confirmed,
the price comparison runs and the row becomes a Match or a Mismatch.

---

## Multiple matches — the app refuses to guess

Claim: **PVC Pipe 3 inch — ₱180**. Adjuster list: *two* identical
"pvc pipe 3 inch" lines (₱180 and ₱185).

Both are perfect name matches — so the claim item becomes **Multiple
matches**, and the app lists every candidate side by side for you to pick.
Picking wrong would change the finding, so it never picks for you. (In this
example the pick also reveals that the adjuster listed the same pipe twice.)

---

## The Adjuster Ledger — the adjuster's side, fully listed

The claim side gets the five verdicts above. The adjuster's side has its own
ledger where **every adjuster row is permanently listed**:

| Status | Meaning |
|---|---|
| **Paired with claim row** | This adjuster line supports a claim item |
| **Unmatched** | No claim item paired with it — omitted items, duplicates, or extra stock live here |

Worked example (3 claim items vs 6 adjuster lines):

| Adjuster row | Ledger status | Why |
|---|---|---|
| common wire nail 2 inch galvanized @ ₱72 | **Paired** | The claim's nail matched it |
| steel bolt m8 zinc @ ₱30 | **Paired** | The claim's bolt matched it |
| zinc steel bolt m8 @ ₱31 | **Unmatched** | A second bolt line — the claim's bolt already paired with the ₱30 line |
| pvc pipe 3 inch @ ₱180 | **Unmatched** (until you pick) | Waiting on the Multiple-matches decision |
| pvc pipe 3 inch @ ₱185 | **Unmatched** | Once you pick one, the other stays listed as the duplicate |
| paint brush 2 inch @ ₱95 | **Unmatched** | The claim never declared any paint brush |

**Unmatched adjuster rows are where the interesting questions live** — items
the adjuster saw that the claim never declared, duplicate lines, and
unexplained stock. Each unmatched row has a **"Find matches"** button that
searches the claim list for its closest items; if you find the right one, one
click pairs them and the prices are re-compared.

---

## "Match" vs "Paired" — an important difference

- **Paired** means the *names* are linked — the pair exists.
- **Match** means the pair exists **and the prices agree**.

That's why the two counters differ: a pair with a price disagreement is
*paired* but shows as **Mismatch** — and that difference is exactly the audit
finding. If every pair were also a price match, there would be nothing to
audit.

---

## When you pair rows by hand

Clicking **"Match"** on an unmatched adjuster row (after using "Find
matches") tells the app: *"these two rows are the same item."* The app
re-points the claim row to that adjuster line and **re-compares the prices of
the new pair**. If the prices disagree, the claim row honestly shows
**Mismatch** — pairing changes *who gets compared to whom*; the price verdict
is always re-delivered.

---

## Jev — the AI reviewer

Needs-review items can be screened in bulk by **Jev** (TypeSafe AI's
"System One" model). For each uncertain pair it answers one typed question —
*"same item?"* — with a probability:

- **80% or higher** → Jev-verified, the pair becomes a match and prices are compared
- **20% or lower** → Jev-rejected, the row is flagged
- **In between** → stays in Needs review for a human

Jev is optional — without a key, everything works and review items simply
wait for a person.

---

## Your data stays yours

Files are read, matched, and analysed **entirely in your browser**. Nothing is
uploaded to any server, there is no database, and closing the tab erases
everything. The only things ever saved (in your own browser) are your Jev API
key and your dark/light preference — and only if you choose to connect Jev.

---

## The knobs you can turn (Settings)

| Knob | What it does |
|---|---|
| **Auto-accept cutoff (90)** | Name-score at or above this auto-matches. Lower it to auto-match more borderline names |
| **Review floor (60)** | Scores below this are dropped entirely (except the single best candidate) |
| **Price tolerance (%)** | A price gap within this percentage of the claimed price still counts as a Match — presets from Exact to ±50% |
| **Depreciation allowance (ACV mode)** | Adjusters often value items below replacement cost. Gaps within this percentage *below* the claim are expected, and are reclassified with a note instead of crying Mismatch |
| **Item-code stripping** | Teaches the app how item codes are embedded in names (auto-detected, or a custom pattern) |

---

## The reports

- **Claim Audit** — every claim row, its verdict, prices, and score
- **Adjuster Ledger** — every adjuster row, paired or unmatched, with total cost
- **Action List** — only the problems, ready to work through
- **Price Summary** — the numbers a claim is argued in: inventory totals in
  total cost (qty × unit price), the variance between the two inventories,
  claim accuracy, over/underpayment exposure, quantity discrepancies, and
  duplicate claim lines
- **Excel export** — all of the above as a formatted 5-sheet workbook
  (Summary, Price Summary, Claim Audit, Adjuster Ledger, Action List)
