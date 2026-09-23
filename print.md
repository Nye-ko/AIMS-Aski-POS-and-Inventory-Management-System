# Thermal printer setup — Epson TM-T82X

Context and step-by-step instructions for wiring up the real thermal printer. When you have the
printer in hand, just ask Claude to read this file and help you finish the setup.

## The printer

- **Model:** EPSON TM-T82X (label model no. M352A)
- **Interface:** USB Type-B (this unit has no built-in Ethernet/WiFi interface card)
- **Serial No.:** X52K005828

## How this app prints

Printing is silent — no browser print dialog. `backend/services/receiptPrinter.js` builds raw
ESC/POS commands using the `node-thermal-printer` npm package, then sends them to the printer one
of two ways depending on `RECEIPT_PRINTER_INTERFACE` in `backend/.env` (see `.env.example`):

```
RECEIPT_PRINTER_INTERFACE=tcp://<printer-ip>:9100          # network printer (Ethernet/WiFi)
RECEIPT_PRINTER_INTERFACE=printer:<windows-share-name>       # USB printer, via a Windows print share
RECEIPT_PRINTER_TYPE=epson
```

`RECEIPT_PRINTER_TYPE=epson` is already the default and matches the TM-T82X's command set — no
change needed there. Leaving `RECEIPT_PRINTER_INTERFACE` empty just disables printing (checkout
still succeeds, the print is skipped and logged).

The TM-T82X here is USB-only (see below), so it uses the second form — `printer:<share-name>`.
That mode is powered by a small custom driver already in the codebase,
`backend/services/winRawPrintDriver.js`: it writes the raw ESC/POS bytes to a temp file and copies
them into the printer's shared Windows queue (`copy /b file \\localhost\<share>`), which is the
standard Windows technique for raw printer output — it skips GDI/text formatting entirely, so the
printer gets its command bytes untouched. This exists because the npm package
`node-thermal-printer` normally expects for this mode (`printer`) turned out to be unmaintained
and does not build on this machine's Node.js version — confirmed by installing it (produced an
invalid, non-functional binary) and forcing a from-source rebuild (fails on the package's own
broken internal dependency chain). `winRawPrintDriver.js` needs **no native npm dependencies at
all**, so this dead end doesn't block anything.

Three things print automatically today, each fire-and-forget right after its action succeeds
(never blocks or fails the underlying request):

| What | Fires from | Function |
|---|---|---|
| Transaction receipt | `POST /api/transactions` (checkout) | `printReceipt` |
| X-Reading (EOD cash count) | `POST /api/reconciliation` | `printXReading` |
| Z-Reading (supervisor-gated sales close) | `POST /api/pos/z-reading` | `printZReading` |

All three were verified against an in-memory fake printer (swaps out `node-thermal-printer` so
the real ESC/POS calls run, just captured as text instead of sent to hardware) — the formatting
and arithmetic are already confirmed correct. What's left is purely the physical connection.


## Setting up the TM-T82X

This unit is USB Type-B, so it has no IP address and `tcp://` can't reach it directly. The path
below uses a Windows print share instead, backed by the app's own `winRawPrintDriver.js` (no
extra software beyond Epson's printer driver, no native npm packages).

1. Plug the printer in via USB, power it on.
2. Install Epson's standard **APD (Advanced Printer Driver)** for the **TM-T82X** from Epson's
   official support site — this makes it appear as a normal printer in Windows (Settings →
   Printers & scanners, or the classic "Devices and Printers" panel).
3. Open that printer's Properties → **Sharing** tab → check **Share this printer**. Give it a
   share name with **no spaces**, e.g. `EPSON_TMT82X` (spaces in the name complicate the raw copy
   command later — keep it simple).
4. Sanity-check the share works before touching the app: from a terminal on this same machine,
   ```
   dir \\localhost\EPSON_TMT82X
   ```
   should succeed without a "network name cannot be found" error. If it fails, the share isn't
   set up correctly yet — fix that first.
5. In `backend/.env`, set:
   ```
   RECEIPT_PRINTER_INTERFACE=printer:EPSON_TMT82X
   ```
   (matching whatever share name was chosen in step 3, exactly).
6. Restart the backend (`npm run dev` / `npm start` in `backend/`).
7. Run a real checkout, an X-Reading close, and a Z-Reading from the POS screen — all three
   should print automatically with no extra clicks.

### Alternative: Epson's TM Virtual Port Driver (network-style, not used here)

Epson also ships a **TM Virtual Port Driver** that makes a USB-connected TM printer appear as a
network printer with a virtual IP, letting the `tcp://ip:9100` mode work instead. It's a valid
alternative if the print-share approach above runs into trouble (e.g. network discovery/sharing
disabled by policy) — download it from Epson's TM-T82X support page alongside the APD driver, run
its setup utility to assign a virtual IP, then set `RECEIPT_PRINTER_INTERFACE=tcp://<that
IP>:9100` instead of the `printer:` form. Not needed for the primary path above.

## When something doesn't look right

Bring back whatever's on the paper (or the backend console's `[receipt-printer]` log line) and
the exact `RECEIPT_PRINTER_INTERFACE` value in use — that's normally enough to tell whether it's
a connectivity problem (printer unreachable), a formatting problem (wrong `RECEIPT_PRINTER_TYPE`),
or something on the Epson driver side.
