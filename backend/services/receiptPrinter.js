// Silent thermal receipt printing: talks straight to the printer over the
// network (raw ESC/POS on port 9100, the "JetDirect" protocol nearly every
// receipt printer supports) so nothing ever opens a browser print dialog.
// Configure via RECEIPT_PRINTER_INTERFACE in backend/.env — see .env.example.

const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');

const INTERFACE = process.env.RECEIPT_PRINTER_INTERFACE;
const PRINTER_TYPE = (process.env.RECEIPT_PRINTER_TYPE || 'epson').toLowerCase();

const TYPE_MAP = {
  epson: PrinterTypes.EPSON,
  star: PrinterTypes.STAR,
  tanca: PrinterTypes.TANCA,
  daruma: PrinterTypes.DARUMA,
  brother: PrinterTypes.BROTHER,
};

function isConfigured() {
  return Boolean(INTERFACE);
}

function money(value) {
  return `P${(Number(value) || 0).toFixed(2)}`;
}

function buildPrinter() {
  return new ThermalPrinter({
    type: TYPE_MAP[PRINTER_TYPE] || PrinterTypes.EPSON,
    interface: INTERFACE,
    removeSpecialCharacters: false,
    options: { timeout: 5000 },
  });
}

async function printReceipt(data = {}) {
  if (!isConfigured()) {
    console.log('[receipt-printer] RECEIPT_PRINTER_INTERFACE not set in backend/.env — skipping silent print.');
    return { printed: false, reason: 'not_configured' };
  }

  const printer = buildPrinter();

  const connected = await printer.isPrinterConnected().catch(() => false);
  if (!connected) {
    console.error(`[receipt-printer] Printer not reachable at "${INTERFACE}" — skipping print.`);
    return { printed: false, reason: 'unreachable' };
  }

  const items = Array.isArray(data.items) ? data.items : [];
  const totalAmount = Number(data.totalAmount) || 0;
  const amountPaid = Number(data.amountPaid ?? totalAmount) || 0;
  const change = Math.max(0, amountPaid - totalAmount);

  printer.alignCenter();
  printer.bold(true);
  printer.println('ASKI MULTI-PURPOSE COOPERATIVE');
  printer.bold(false);
  printer.println('Barangay Andal Aliano, Talisay City');
  printer.println('TIN: 000-000-000-000');
  printer.newLine();

  printer.alignLeft();
  printer.println(`Txn No.: ${data.transactionId ?? 'N/A'}`);
  printer.println(`Date: ${new Date().toLocaleString()}`);
  printer.println(`Cashier: ${data.cashier ?? 'N/A'}`);
  printer.drawLine();

  items.forEach((item) => {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unitPrice ?? item.price ?? 0) || 0;
    printer.tableCustom([
      { text: String(item.name || 'Item').slice(0, 20), align: 'LEFT', width: 0.5 },
      { text: String(quantity), align: 'CENTER', width: 0.15 },
      { text: money(quantity * unitPrice), align: 'RIGHT', width: 0.35 },
    ]);
  });

  printer.drawLine();
  printer.tableCustom([
    { text: 'SUBTOTAL', align: 'LEFT', width: 0.6 },
    { text: money(data.subtotal ?? totalAmount), align: 'RIGHT', width: 0.4 },
  ]);
  printer.tableCustom([
    { text: 'DISCOUNT', align: 'LEFT', width: 0.6 },
    { text: money(data.discountAmount ?? 0), align: 'RIGHT', width: 0.4 },
  ]);
  printer.bold(true);
  printer.tableCustom([
    { text: 'TOTAL', align: 'LEFT', width: 0.6 },
    { text: money(totalAmount), align: 'RIGHT', width: 0.4 },
  ]);
  printer.bold(false);

  if (String(data.paymentMethod || '').toUpperCase() === 'CASH') {
    printer.tableCustom([
      { text: 'CASH', align: 'LEFT', width: 0.6 },
      { text: money(amountPaid), align: 'RIGHT', width: 0.4 },
    ]);
    printer.tableCustom([
      { text: 'CHANGE', align: 'LEFT', width: 0.6 },
      { text: money(change), align: 'RIGHT', width: 0.4 },
    ]);
  }

  printer.drawLine();
  printer.alignCenter();
  printer.println('Thank you for your purchase!');
  printer.newLine();
  printer.cut();

  try {
    await printer.execute();
    console.log(`[receipt-printer] Printed receipt for txn ${data.transactionId ?? 'N/A'}.`);
    return { printed: true };
  } catch (err) {
    console.error('[receipt-printer] Print failed:', err.message);
    return { printed: false, reason: 'error', error: err.message };
  }
}

module.exports = { isConfigured, printReceipt };
