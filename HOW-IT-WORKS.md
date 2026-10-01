# How Price Verifier Works

*A plain-language guide for anyone reviewing a claim. No technical background needed.*

---

## The big picture

Two people went through the same wrecked warehouse and each wrote down their own list:

- **File A — the insured's Ending Inventory.** What the insured says was on the shelves, with the value they are asking for.
- **File B — the adjuster's Costing file.** What the adjuster counted, and what they say each thing should cost.

Price Verifier puts the two lists side by side and asks **three separate
questions** about every line. The order matters, and the questions never get
mixed up:

1. **Is it the same thing?** (identity)
2. **How many?** (quantity)
3. **What should it cost?** (valuation)

The app refuses to answer the price question until the identity question is
settled. Comparing prices between two things that aren't the same thing is
arithmetic, not auditing — and that mistake is the single easiest way to
manufacture a "finding" that isn't real.

Nothing on either list is ever thrown away. Every row of both files stays
visible from the moment you upload to the moment you export.

---

## The three layers, explained like you're ten

**Layer 1 — Is it the same thing?**
Like matching a name tag. "Air filter, part 23390-0L070" and "23390-0L070 —
Fuel Filter, Hi-Lux" both carry the same part number, but one calls it an air
filter and the other calls it a fuel filter. Those are **not the same thing**.
The app notices this and stops, because only a person or the insured can say
which label is right.

**Layer 2 — How many?**
The quantities on each list. The app adds them up and shows the difference. It
does not yet test them on its own — see *What it doesn't do yet*.

**Layer 3 — What should it cost?**
Once an item is identified, the app looks up **every** costing line that refers
to it — not just the first one — and shows you the whole spread: the cheapest,
the dearest, and a weighted average. It then tells you where the insured's
number sits relative to that spread. It does **not** pick a price for you. No
price is ever accepted automatically.

---

## How it decides two items are the same

Three attempts, tried in order. The first one that finds something wins.

**Attempt 1 — the part number.**
Most real parts carry a maker's code: `23390-0L070`, `A-1022`, `KBJ-1202`,
`208-54109`. The app reads these codes out of the description text *and* out of
a separate "Part No. / SKU / Code" column when your file has one. It reads
`A-1022` and `A1022` as the same code, because the dashes and spaces don't
change what the part is.

Two things it will **not** mistake for a part number:

- **Sizes.** `M8` and `5L` are bolt threads and engine sizes, not part numbers.
- **Dates.** `2024` in a description is a year, not a code.

And it reads sizes that really do matter: `27x40x6`, `27 × 40 × 6` and `27-40-6`
are all recognised as the same size, whatever separator somebody typed.

**Attempt 2 — the description, word for word.**
If there's no shared part number, the app compares the cleaned-up descriptions.
Capitalisation, punctuation and word order don't count. Auto-parts shorthand is
translated first, so `FRT` and `Front` are the same word, `ASSY` means
`assembly`, and `Hi-Lux` and `Hilux` are the same word.

One thing it is careful about: **left and right are never treated as the same
thing.** `LH` becomes `left` and `RH` becomes `right`, and they stay different
all the way through. A left-hand brake pad is not a right-hand brake pad.

**Attempt 3 — "these look similar."**
If nothing matched exactly, the app says "these might be the same" and lists the
closest names it found. That's all it does. Similar-looking is never treated as
proof — a person has to say yes before the row counts as identified.

**If none of the three find anything:** the row is **Unmatched**. It stays on
the list, flagged, waiting for someone.

---

## The five labels a claim line can get

| Label | What it means in plain words | What happens next |
|---|---|---|
| **Confirmed** | We found the same part number on both sides | Nothing — it's identified |
| **Strong** | The descriptions are word-for-word the same after tidying up | Nothing — it's identified |
| **Probable** | Nothing matched exactly, but a name looks close | A person (or Jev) decides. **Never automatic** |
| **Conflict** | The part number matches but the descriptions describe different products | **Query the insured** — one of the two labels is wrong |
| **Unmatched** | Nothing on the other list gives us anything to go on | Possible item the other side never saw. Investigate |

The first two mean "yes, these are the same item". The third means "here's a
suggestion, human please". The fourth means "the paperwork contradicts itself".
The fifth means "we found nothing".

---

## Worked examples

| The inventory says | The costing file says | Label | Why |
|---|---|---|---|
| `BRG 6202 2RS` | `Ball Bearing 6202 2RS` | **Strong** | The part number 6202 is on both sides and the descriptions agree |
| `AIR FILTER 23390-0L070` | `23390-0L070 Fuel Filter, Hi-Lux/Innova '16` | **Conflict** | Same part number, different product. Ask the insured which one it is |
| `WIPER BLADE 24"` | `Wiper Blade 24 inch` | **Strong** | Same words once the quote mark becomes "inch" |
| `OIL FILTER TOYOTA` | `Oil Filter Toyota Hilux` | **Probable** | Very close, but no shared part number — a person confirms it |
| `Front Brake Pad Set` | `FRT BRK PAD SET` | **Strong** | `FRT` and `Front` mean the same thing |
| `Brake Pad Set LH` | `Brake Pad Set RH` | **Not the same item** | Left and right stay different, on purpose |
| `Seal 27x40x6` | `Seal 27-40-6` | **Strong** | Same size, different typing |
| `Ball Bearing 6202` | `Ball Bearing 6203` | **Not the same item** | One digit apart = a different bearing. It will never quietly pair these |

A **Probable** is not a failure. It is the app saying *"please look at this pair."*

---

## The Conflict case, in full

This is the one that matters most, so it is worth spelling out.

The inventory says: `AIR FILTER 23390-0L070`.
The costing file says: `23390-0L070 — Fuel Filter, Hi-Lux/Innova '16`.

The part numbers are identical. Everything else disagrees. Either the insured
labelled the item wrongly, or the costing file printed the wrong description
against a real part number.

The app does not guess, and it does not silently pick the cheaper price. It marks
the row **Conflict**, keeps both descriptions side by side, and puts it at the
top of the work list. Your job is to ask the insured which product was actually
in the warehouse — or to go back to the supplier about the catalogue entry.

---

## What it does with prices

For every item it has identified, the app gathers **all** the costing lines that
match it, and shows you:

- **How many** costing records it found
- The **lowest** and **highest** of them
- A **weighted average** (weighted by quantity when the costing file has
  quantities, otherwise a plain average)

Nothing is locked to one row. One costing line can support several inventory
lines, and each of those lines sees the full set.

Lines with **no usable price** (blank, zero, or something unreadable like `TBA`)
are counted — they are still proof the item exists — but they are **left out of
the price range**. A missing price is not a cheap price, and treating it as one
would drag the "cheapest" figure down and invent findings.

Your claimed price is then sorted into one of five positions:

| Position | Meaning |
|---|---|
| **In range** | Between the cheapest and the dearest costing record. Fine. |
| **Above the range** | Higher than every costing record. This is where overpayment exposure comes from. |
| **Above the range, explained** | Higher than everything, but within the depreciation allowance (see below). Expected, not a finding. |
| **Below the range** | Cheaper than every costing record. Usually in the insured's favour. |
| **No usable price** | Nothing to compare against. |

**Overpayment exposure** is the total of "how much more than the dearest costing
record" across all the rows sitting above the range. It's the headline number in
the Price Summary — but it is a starting point for a conversation, not a verdict.

---

## Depreciation: when a gap is expected, not suspicious

Adjusters are required to value stock at **actual cash value** — today's
replacement price minus a deduction for age and condition. So a claim priced at
replacement cost will legitimately sit above the adjuster's costing by a few or
twenty percent, every single time, for every single item.

If you set a **depreciation allowance**, the app treats gaps up to that
percentage as expected and marks them "explained" instead of "potential
overpayment". They stop counting toward overpayment exposure.

This changes **only the price commentary**. It never changes whether two items are
identified as the same. Turning the allowance up cannot turn an Unmatched row
into a Confirmed one, and cannot hide a Conflict.

---

## The Adjuster Ledger — the adjuster's side, fully listed

The inventory side gets the five labels above. The costing side has its own
ledger where **every costing row is permanently listed**:

| Ledger status | Meaning |
|---|---|
| **Paired → A12, A48** | This costing line supports these inventory rows (there can be more than one) |
| **Unmatched** | No identified inventory item points at it |

**Unmatched costing rows are where the interesting questions live** — items the
adjuster saw that the inventory never declared, duplicate lines, stock the
insured didn't claim. Each unmatched row has a **Find matches** button that
searches the inventory for its closest items. If you find the right one, one
click confirms the pairing, the inventory row becomes **Confirmed**, and its
price evidence is collected afresh.

Note the two counters are deliberately different: a costing line can be paired
with two inventory lines, and one inventory line can rest on several costing
lines. The ledger never hides a line to make the numbers tidy.

---

## Jev — the AI second opinion

**Probable** and **Conflict** rows can be screened in bulk by **Jev** (TypeSafe
AI's "System One" model). For each uncertain pair it answers one question —
*"same item?"* — with a confidence:

- **80% or higher** → confirmed, the pair becomes Confirmed and its price evidence is gathered
- **20% or lower** → rejected, the candidate is dropped
- **In between** → stays in review for a person

Jev is optional. Without a key, everything works and those rows simply wait for a
human — which is how they worked before Jev existed.

You can also just confirm a pair yourself with the **Confirm this match** button.
A person outranks Jev, and you can always overrule either one.

---

## Your data stays yours

- Your files are read **by your own browser** and are **never uploaded** to any server.
- Matching runs on your own computer, in a background process in the page.
- Results live only while the tab is open. **Refreshing the page erases them.**
- There is no database and nothing is saved on any server.
- The only thing that ever leaves your machine is Jev screening, and that sends **only the two text descriptions** of the pair being screened. Nothing is stored or logged.
- The only things this app remembers anywhere are your Jev API key and your light/dark preference — and both live in your own browser, not on a server.

If the app is offline, everything except Jev screening still works.

---

## The knobs you can turn (Settings)

| Knob | What it does |
|---|---|
| **Review floor (60)** | How similar a name must be before it's even offered as a suggestion. Lower it to see more weak candidates; raise it to see fewer. |
| **Reference gap tolerance %** | Just widens the "here's the difference" band for display and filtering. It cannot change a status. |
| **Item-code stripping** | Teaches the app that your inventory names start with an internal code (`ITM-00122 Finishing Nail 2 inch`) and tells it how to take that code off before comparing names. |
| **Depreciation allowance (ACV mode)** | Off / −5 / −10 / −15 / −20 / −30 / −50. Treats gaps up to that size as expected depreciation rather than overpayment. Changes price commentary only — never identity. |

There is deliberately **no** "auto-accept" switch. The app cannot be configured to
accept a match on name similarity alone.

---

## What it doesn't do yet

Stated plainly, because a tool that hides its gaps is worse than no tool:

1. **The real files have never been through it.** Everything above has been tested against invented data, not the actual Ending Inventory and Costing workbooks.
2. **Quantity is reported, not tested.** The app adds up claimed and verified units and shows the difference, but it does not flag a row as "quantity not verified" on its own.
3. **It does not choose an accepted price.** It gathers the evidence for that decision and lays it out; the decision is still made by a person.
4. **Documentary support is not attached.** The inventory may declare "Specific Identification" as its costing method, but the workbook carries no lot or item identifiers that would let anyone trace a line back to a specific purchase. Until invoices, purchase journals, stock/bin cards or an inventory subsidiary ledger are supplied, that declaration is unverified — ask for them.

---

## The reports

- **Claim Audit** — every inventory row: what it was identified against, its part codes, the full cost range behind it, and its label
- **Adjuster Ledger** — every costing row, paired or unmatched, with total cost
- **Action List** — everything not Confirmed or Strong, ready to work through
- **Price Summary** — both inventory totals in total cost, the variance between them, how many claims sit inside / above / below / unpriced, overpayment exposure, the quantity check, duplicate inventory lines, and costing rows nobody claimed
- **Excel export** — all of the above as a formatted five-sheet workbook (Summary, Price Summary, Full Audit, Action List, Adjuster Ledger), with a "how to read this report" methodology block on the first two sheets