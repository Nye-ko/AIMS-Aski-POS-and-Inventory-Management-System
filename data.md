# Monthly real-data import (Coop Store + Coke Talavera)

Context for continuing the recurring monthly data-import work. When asked to "make that script" for
a new month, read this file first.

## What this is

The store's owner (Maam Neri / the coop) tracks two business lines by hand in Excel: **Coop Store**
(general merchandise) and **Coke Talavera** (a Coca-Cola distributor line). Every month they produce:

1. A **physical inventory recount** workbook (one per business line): every product's barcode, name,
   category, unit cost, and an actual/ending physical count.
2. A **sales book** workbook (one per business line): every sale line item for the month, grouped by
   transaction number.

These get imported into the live Postgres database (Product/Supplier/Transaction/StockMovement via
Prisma) so the POS/IMS system's stock levels and Sales Report/Demand Forecast history reflect reality.

A third business line, **Jazz Eat**, exists in the Coke Talavera sales workbook (a "JAZZ EAT" sheet)
but has never been imported — it's out of scope for this system by design, not an oversight.

## File locations and naming (as seen so far)

```
backend/data/INVENTORY/
  JULY 2026/07. FINAL INVENTORY REPORT AS OF JULY 2026-PRINTING & COOP STORE.xlsx   (Coop, baseline)
  JULY 2026/7. INVENTORY REPORT AS OF JULY 2026.xlsx                                (Coke, baseline)
  08. FINAL INVENTORY REPORT AS OF AUGUST 2026-...-checked Maam Neri.xlsx           (Coop, August)
  8. COKE INVENTORY REPORT AS OF AUGUST 2026.xlsx                                   (Coke, August)

backend/data/SALES/
  02. SALES BOOK JULY 2026-PRINTING & COOP STORE.xlsx   (Coop, contains May/Jun/Jul sheets)
  5/6/7. SALES <MONTH> 2026 JAZZ EAT & COKE TAL.xlsx    (Coke, one file per month, May-Jul)
  08. SALES BOOK AUGUST 2026-PRINTING & COOP STORE.xlsx (Coop, August — also a cumulative
                                                          Jan-Aug workbook; only that month's own
                                                          sheet gets imported)
  8. SALES AUGUST 2026 JAZZ EAT & COKE TAL.xlsx         (Coke, August)

backend/data/PURCHASES/
  (May/Jun/Jul purchase books — used only to resolve a supplier name for brand-new products;
   no August purchases book has been provided yet, so new August products got supplierSource:
   'none' for Coop, or the single known fallback supplier for Coke.)
```

**The naming is not perfectly consistent month to month** (leading zero on "08." vs "8.", a
"-checked Maam Neri" suffix, etc.) — don't assume a fixed pattern; list the directory and confirm
the exact filenames before writing a script.

## Sheet names and headers to expect

- Coop Store inventory: sheet **"CONVIE - final"**. Header row found by scanning for "BARCODE" in
  columns A-F within the first 10 rows. Expected columns: SHELF DESCRIPTION, BARCODE, PRODUCT NAME,
  UNIT COST, an actual-count column, TOTAL (a formula-computed running total, used as a fallback).
  **Watch out:** the actual-count column's header changes name every month — it was "ACTUAL
  INVENTORY" in July, "ACTUAL INVENTORY (ANGGE)" in August (the recount-taker's name gets appended).
  Match it with a "starts with ACTUAL INVENTORY" fallback, not an exact string.
- Coke Talavera inventory: sheet **"COCA COLA"**. Columns: SHELF DESCRIPTION, BARCODE, PRODUCT NAME,
  UNIT COST, SRP, and **"ENDING INVENTORY-MANUAL"** (the real count; falls back to "ENDING INVENTORY
  - MANUAL" / "ENDING INVENTORY" if renamed). A mid-sheet subtotal row ("TOTAL COST" / "TOTAL
  QUANTITY" in columns 4-5) and a signature block near the very end are harmless — they have no
  value in the ending-inventory column so the parser's "skip rows with no resolvable count" logic
  already excludes them.
- Coop Store sales: sheet named **"<MONTH> 2026-Convie"** (e.g. "AUG 2026-Convie"). Columns: DATE,
  PARTICULAR (barcode), TRANSACTION NO:, DESCRIPTION, QTY., UNIT PRICE, SALES DISCOUNT.
- Coke Talavera sales: sheet **"COKE"** only (ignore the "JAZZ EAT" sheet in the same file — see
  above). Columns: DATE, PARTICULAR (barcode), TRANSACTION (number), DESCRIPTION, QTY, UNIT PRICE,
  SALES DISCOUNT.
- Header row is never row 1 — it's found dynamically by `buildHeaderMap()` scanning for an anchor
  header ("BARCODE" for inventory sheets, "DATE" for sales sheets) in the first ~10 rows.

## Existing scripts (one-off per month, hardcoded filenames)

- `backend/importRealData.js` — July baseline. Creates every Coop/Coke product fresh (barcode is the
  dedup key), one OPENING StockMovement per product valued at the end-of-July count. Historical
  sales before July are not replayed.
- `backend/importSalesData.js` — May, June, July sales (Coop + Coke) as `HIST-<sourceTag>-<txnNo>`
  Transactions. Does not touch Product.stock (May-Jul sales already happened before the July
  physical count that set current stock).
- `backend/importAugustInventory.js` — August recount. Most products already exist this time:
  existing ones get stock corrected via one **ADJUSTMENT** StockMovement (delta = August count minus
  current DB stock) and their costPrice/price updated to August's sheet values; brand-new barcodes
  get a fresh Product + OPENING movement, same as July.
- `backend/importAugustSales.js` — August sales, same pattern as `importSalesData.js`. Run this
  *after* the inventory script, since some August sales are for products that don't exist until the
  inventory import creates them.

All four take `--commit` to actually write; with no flag they dry-run and print a report only. All
are safe to re-run: existing barcodes and existing `transactionNo`s are skipped, so re-running never
duplicates data.

## Design decisions already made (carry these forward unless told otherwise)

- **Stock correction policy**: for products that already exist, correct stock to the new physical
  count exactly via an `ADJUSTMENT` StockMovement (not a second OPENING). New products get `OPENING`.
- **Cost/price policy**: update `costPrice`/`price` to the new sheet's values for existing products
  too (not just stock) — the user chose this explicitly over "stock only, leave cost/price alone".
- **Large deltas are expected**: Coke Talavera moves large volumes (thousands of units/month per
  SKU) — don't treat a big delta as a parsing bug without checking the source numbers first.
- **New-product supplier/price resolution**: try to match by product name against the known
  May-Jul purchase books (supplier) and all sales sheets seen so far, including the current month's
  own (price, Coop only — Coke gets its price from the SRP column, and falls back to a single known
  distributor supplier when no purchase-book match exists).
- **Test data must stay out of the historical ledger.** Before the August import, a surgical cleanup
  removed 7 live-test POS transactions, a test Purchase Order/Receiving Report/Purchase Return trio,
  and a test Reconciliation that had accumulated from live UI testing — including reversing the
  stock/member-points side effects those test records had caused. If new stray test transactions
  turn up before a future month's import, the same approach applies: identify every non-`HIST-`
  transaction and any PO/RR/PR/Reconciliation dated after the last real import, confirm with the user
  exactly what's test data, then delete it and reverse its stock/points effects before importing.

## Next step, when asked

Right now each month needs a developer (Claude) to write a new pair of scripts (copy the previous
month's, swap in the new filenames/sheet names) before the team can run them — this was a deliberate
choice ("just tell me what to run for now" over generalizing). If asked to build the reusable
version instead: one generic script per import type (inventory, sales) that takes the month/year and
explicit file paths as arguments, so the team can run it themselves every month without new code.
Ask design questions first (per this project's standing rule) before building it — e.g. how to
handle a business line with no file for a given month, and whether to keep the dry-run/`--commit`
convention.
