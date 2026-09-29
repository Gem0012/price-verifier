# Robustness Notes — what to do when your real files misbehave

This guide is for the person running Price Verifier on **real** masterlist and
price files. The engine was hardened for messy spreadsheets, but Excel files
from the wild can still surprise you. Below: what you'd see, why it happens,
and what to click.

The controls this app gives you (used throughout this guide):

- **Sheet** — pick which worksheet of the workbook to compare.
- **Header row** — tell the app which row holds the column titles.
- **Name column / Price column** — override the auto-picked columns.
- **Settings → Auto-accept cutoff** — similarity (0–100) at or above which a
  match is accepted automatically.
- **Settings → Review floor** — similarity below which candidates are hidden
  entirely (except the single best guess).
- **Settings → Price tolerance** — how big a price difference still counts as
  a Match.
- **Settings → code strip mode** — how the item code is removed from File A
  names (Auto / first token / last token / none / custom regex), and Apply /
  re-run to see the effect.

---

## Problem playbook

### 1. Wrong row was picked as the header (titles, company names above the table)

- **Symptom:** the column dropdowns show odd labels like "ACME HARDWARE SUPPLY
  CO." or "Column A", the preview looks shifted, or the row count is far too
  small.
- **Cause:** a title block, company letterhead or blank rows sit above the real
  header. The app scans the first 20 rows and scores them, but decorative
  sheets can still fool it.
- **What to do:** open **Header row** and pick the row that contains the column
  titles ("Row 1", "Row 2", …). The preview and row count update immediately.

### 2. The workbook has several sheets (summary sheet first, data on sheet 2)

- **Symptom:** almost no data rows, or the wrong table entirely.
- **Cause:** the app starts with the first sheet, which is often a cover or
  summary.
- **What to do:** pick the correct sheet in the **Sheet** dropdown. Header row
  and columns re-detect automatically when you switch.

### 3. Column titles the app doesn't recognize (e.g. "Nama Barang", "Harga",
"Descripción", "Presyo")

- **Symptom:** the wrong column is pre-selected as Name or Price.
- **Cause:** keyword detection understands English plus common Indonesian,
  Spanish, German/French price words and accented spellings, but not everything.
- **What to do:** set **Name column** and **Price column** manually. Nothing
  else needs to change — the matching engine uses whichever columns you pick.
  Also check the *Date* column is not pre-selected as the price column; the app
  now avoids columns labelled like dates, but a creatively named one ("As of",
  "Encoded") can still slip through.

### 4. Merged cells (a merged title, or merged cells inside the table)

- **Symptom:** some items are missing entirely, or a header label appears only
  on the first of several merged columns.
- **Cause:** in merged ranges Excel stores the value only in the top-left cell;
  the other cells look empty to any reader.
- **What to do:** best fixed in Excel itself — select the table area, **Unmerge
  cells**, and fill the values down/across (select → Find & Replace blanks is a
  quick way), then re-upload. Merged title rows above the header are handled by
  **Header row** as in problem 1.

### 5. A "TOTAL" or footer line at the bottom of the file

- **Symptom:** previously: a junk "Not found" row for TOTAL with a strange
  match suggestion. **Now:** those rows are detected and marked **Not found**
  with a note ("a total/footer line or numbers only — matching skipped"), and
  they are never suggested as matches.
- **What to do:** nothing — ignore the row(s). They are excluded from the File
  B index too, so they can never win as candidates. Just remember the row count
  includes them.

### 6. A File A row has a price but no name (or a name but no price)

- **Symptom:** rows without a name are skipped silently and don't appear in
  results at all; rows with a name but unreadable price show as **Needs
  review** with the note "File A price could not be read."
- **Cause:** empty name cells (common when a merged/indented layout leaves the
  name only on the first row of a group), or a price cell containing text like
  "N/A".
- **What to do:** for grouped/merged layouts, fill the name down in Excel
  before uploading. For unreadable prices, fill the price by hand from the
  candidate panel.

### 7. The item code is not the first word — e.g. "Wire Nail 2 inch (ITM-00001)"

- **Symptom:** matches look worse than expected; similarity scores are lower
  for exactly those rows.
- **Cause:** by default the app removes the code only when most names carry a
  code-like token in the same position. Codes in **trailing parentheses** are
  now detected and stripped automatically (also in Auto mode), and codes like
  "AB-12/3" are recognized.
- **What to do:** if detection still misses your layout, set code strip mode to
  **Custom regex** and enter a pattern that matches the code, e.g.
  `\([A-Z]+-\d+\)` for "(ITM-00001)". Keep the regex simple — a pathological
  pattern can hang the run (see Limitations).

### 8. File B descriptions carry a stray code or vendor prefix — "ITM-0009
Safety Glove Leather", "SKU-123 heavy duty gloves", "VENDOR: nail 2 inch"

- **Symptom:** previously these scored lower or never matched exactly.
  **Now:** when File A is detected as using first-token codes, the app also
  tries matching File B rows *without* their leading code/prefix ("ITM-0009",
  "SKU-123", "vendor", "sku", "item"…) and keeps the better score, including
  exact matches. Sizes ("2 inch", "no 10", "m8") are never mistaken for codes.
- **What to do:** nothing. If File B's prefix is something exotic (a store
  name, "MEGA STORE nail 2 inch"), it is NOT stripped — expect those rows in
  **Needs review** and pick manually.

### 9. Prices read wrongly: dates, fractions, "1.250.500"

- **Symptom:** huge or tiny price numbers, MISMATCH rows that look identical.
- **Cause & status:**
  - Dates stored as **text** ("2024-05-12", "12/05/2024", "12.05.2024") and
    fractions ("5 1/2") are now **rejected** (price reads as unreadable →
    Needs review) instead of turning into garbage numbers.
  - Dot-thousands amounts ("Rp 1.250.500") are now read as 1,250,500.
  - An **Excel date column picked as the price column** is avoided when its
    header looks like a date. If it still happens, the serial number (45000-style)
    is indistinguishable from a real 45,000 price — fix the column with
    **Price column**.
  - **Ambiguous "1.250"** (exactly three decimals, no other separators) is read
    the US way: 1.25, not 1,250. If your prices use that style, this is a known
    limitation — see below.
  - Currency symbols/codes (₱, $, €, PHP, USD, P, RM, Rp…) are ignored when
    reading prices. "(500)" reads as −500 — a negative price is usually a
    credit/adjustment row; check those manually.
- **What to do:** pick the right **Price column**; use **Price tolerance** to
  absorb trivial rounding differences.

### 10. The same item appears twice in File A, or one File B row could serve
many File A items

- **Symptom:** both File A rows are matched independently; that is fine. When
  **one File A description** matches two or more File B rows, the status is
  **Multiple matches** and lists every candidate so you can pick.
- **What to do:** nothing automatic — pick the right File B row from the
  candidate list. If a genuinely duplicated masterlist row bothers you, dedupe
  File A in Excel first.

### 11. Everything lands in "Needs review" (scores in the 60–89 band)

- **Symptom:** correct items found but not auto-accepted.
- **Cause:** File B words the items too differently for the similarity to reach
  the auto-accept cutoff (default 90). Word order, extra words ("philippines",
  "brand"), synonyms and plural/singular all cost points.
- **What to do:** lower **Auto-accept cutoff** a bit (e.g. 85) and re-run, or
  accept the review workload — review is exactly what the band is for. Raise
  **Review floor** if too many useless candidates clutter the view (or lower it
  to 0 to always see the best guess even when it's bad).

### 12. Numbers stored as text ("1,250.50" in a text cell)

- **Symptom:** none — prices still read correctly.
- **Cause:** none — the price reader accepts text as long as the cell contains
  a recognizable number.
- **What to do:** nothing.

### 13. The file has no header row at all (data starts immediately)

- **Symptom:** the first data row is treated as the header and disappears; the
  column labels are item names.
- **What to do:** this is a known limitation — the app needs a header row.
  Quickest fix: add one in Excel (insert a row above the data, type "Name" and
  "Price"), re-save, re-upload.

---

## Known limitations (not fixable in the app)

- **Header row dropdown only reaches Row 10.** The app auto-detects headers as
  deep as row 20, but if detection fails *and* your header is below row 10 the
  dropdown cannot select it — add/move the header higher in Excel.
- **Ambiguous "1.250"** stays ambiguous. With exactly one dot followed by three
  digits and nothing else, the app reads 1.25 (US style). European/Indonesian
  files that write thousands this way will mismatch — reformat in Excel
  (multiply by 1000 or use Format Cells) if unsure. "1.250,50" and "1,250.50"
  are handled correctly.
- **Excel serial dates in a date-formatted cell** (45000) are genuinely
  indistinguishable from the price 45000 once the wrong column is selected.
  Correct **Price column** is the only remedy.
- **Merged data cells** lose the repeated value (see problem 4/6). Fix at the
  source.
- **Exotic vendor prefixes** ("MEGA STORE nail 2 inch") are not stripped —
  only code-like prefixes and common label words are.
- **"2in" vs "2 inch" vs "2 inch"** score about 67–85 similarity — usually
  enough to surface in review, rarely enough to auto-accept. Consider cleaning
  sizes in File B if you want those automatic.
- **Custom regex for code stripping** is validated (invalid patterns are
  ignored safely and the name is left unchanged), but a *catastrophic*
  backtracking pattern (nested quantifiers like `(\w+\s?)*$`) can still hang
  the worker — keep patterns simple and anchored.
- **Scanned/image files, PDFs, password-protected workbooks** cannot be read.
- **Files with tens of thousands of rows** work but the results table itself
  may feel heavy in the browser (see below).

---

## Performance — what row counts are comfortable

All processing runs in your browser in a background worker; nothing is
uploaded. Measured on the hardened engine (Node benchmark; browsers typically
run the same work 2–3× slower):

| File A rows × File B rows | Time (Node)         | Verdict                          |
|---------------------------|---------------------|----------------------------------|
| 5,000 × 20,000 (typical)  | ~4.5 s              | Comfortable — a coffee sip       |
| 20,000 × 50,000           | extrapolate ~10–15 s| Fine, watch the progress bar     |
| 50,000 × 100,000          | ~13 s / ~350 MB RAM | Works; in-browser expect 30–40 s |

- The engine keeps at most **400 fuzzy candidates** per File A row (IDF-ranked
  pool) and stores **10 candidates** per result, so memory grows roughly
  linearly with row count; the 50k×100k stress test used ~350 MB.
- Duplicated names in File A are re-matched cheaply; big wins come from exact
  duplicates which short-circuit.
- If a run feels stuck: it is almost always the **fuzzy pool build on very
  common words** ("inch", "steel") — it still finishes, just slower. Reducing
  File B to the relevant rows (delete obviously unrelated sections, or split
  the workbook by sheet) speeds everything up proportionally.
- Uploading a 50k-row workbook takes a few extra seconds to parse; the
  "running" stage progress bar reflects matching only.

---

## What was hardened recently (for reference)

- Header detection scans 20 rows, understands international header words
  (Nama/Harga/Uraian, Descripción/Precio, Importe, …) and ignores accents.
- Date/serial columns are kept away from the price column; text dates and
  fractions in a price cell no longer become garbage numbers; dot-thousands
  ("1.250.500") read correctly.
- Total/footer rows and digits-only rows on either side are skipped and never
  suggested as matches.
- Trailing "(ITM-00001)" codes are detected and stripped, including Auto mode.
- File B rows with stray leading codes ("ITM-0009 …", "SKU-123 …") or vendor
  labels ("VENDOR: …") match via their code-stripped description as well.
- Full-width characters (２inch, Ｍ８) normalize to ASCII before matching.
- The matching core was made 3× faster with byte-identical results
  (precomputed bigrams, typed-array candidate pool).

## Motor-parts catalogs ("family alike" numbers)

Auto-parts and motor-part lists are the hardest case for fuzzy matching:
sibling parts differ by one digit while everything else is identical
("Ball Bearing 6202 ZZ" vs "Ball Bearing 6203 ZZ" score ~93% alike in
character terms, but they are different parts with different prices).

The matcher now handles this with a numeric-sibling penalty: when two
descriptions differ ONLY in numeric tokens, each differing number subtracts
22 points (capped at 45) from the similarity score.

What this means in practice:
- A wrong sibling (one digit off) scores ~49-70 → lands in Needs-review or
  is dropped entirely — it can never be auto-accepted as a false match.
- An exact part-number match still scores 100 and matches as before.
- Reordering, extra words, or synonyms keep the normal behavior (word
  differences are not penalized; only purely numeric differences are).
- Watch for: the same part listed with pack quantities ("per box 12") can
  land in Needs-review — confirm manually once, then trust the pattern.

If your catalog uses numbers as WORDS (e.g. "size one" vs "size two"), the
penalty does not apply — those are treated as rewordings.
