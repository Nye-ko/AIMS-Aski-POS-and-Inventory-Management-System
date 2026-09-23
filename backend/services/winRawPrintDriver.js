// Sends raw ESC/POS bytes to a printer's shared Windows print queue via a binary file copy
// (`copy /b file \\localhost\<share>`) — the standard Windows trick for raw printer output that
// skips GDI/text formatting entirely, so the thermal printer's own command bytes reach it intact.
//
// This exists in place of the `printer` npm package that node-thermal-printer's `printer:<name>`
// interface mode normally expects (see lib/interfaces/printer.js in that package) — that package
// is unmaintained and fails to build on current Node.js (confirmed: its prebuilt binary isn't a
// valid Win32 DLL, and a from-source rebuild fails on its own broken devDependency chain). This
// module implements the same minimal shape (getPrinters/getPrinter/printDirect) node-thermal-
// printer expects from a driver, with zero native dependencies. See print.md for setup.
//
// Requires: the printer installed in Windows (via its own driver) with "Share this printer"
// turned on, using a share name with no spaces — that share name is what goes after `printer:` in
// RECEIPT_PRINTER_INTERFACE (e.g. printer:EPSON_TMT82X).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');

// 'auto' printer selection (picking a RAW-ONLY printer automatically) isn't supported here — an
// explicit share name is always required in RECEIPT_PRINTER_INTERFACE, so this just needs to
// exist to satisfy the interface shape.
function getPrinters() {
  return [];
}

// There's no cheap way to probe a shared queue's live status without shelling out on every
// checkout, and isPrinterConnected() only needs a status that doesn't contain 'NOT-AVAILABLE' —
// so this reports ready and lets the actual print attempt in printDirect surface real failures
// (unreachable share, printer offline, etc.) through its own error callback.
function getPrinter(name) {
  return { name, status: 'READY' };
}

function printDirect({ data, printer, docname, success, error }) {
  const tempFile = path.join(os.tmpdir(), `aims-print-${Date.now()}-${Math.random().toString(36).slice(2)}.prn`);

  fs.writeFile(tempFile, data, (writeErr) => {
    if (writeErr) {
      error(writeErr);
      return;
    }

    const target = `\\\\localhost\\${printer}`;
    exec(`copy /b "${tempFile}" "${target}"`, (execErr, stdout, stderr) => {
      fs.unlink(tempFile, () => {});
      if (execErr) {
        error(new Error(stderr || execErr.message));
        return;
      }
      success(docname || 'raw-print');
    });
  });
}

module.exports = { getPrinters, getPrinter, printDirect };
