// Silent thermal receipt printing: talks straight to the printer over the
// network (raw ESC/POS on port 9100, the "JetDirect" protocol nearly every
// receipt printer supports) so nothing ever opens a browser print dialog.
// Configure via RECEIPT_PRINTER_INTERFACE in backend/.env — see .env.example.

const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');
const { STORE_INFO } = require('../config/storeInfo');
const winRawPrintDriver = require('./winRawPrintDriver');

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
    // Only used by the `printer:<share-name>` interface mode (see winRawPrintDriver.js);
    // ignored by the `tcp://` network mode.
    driver: winRawPrintDriver,
    removeSpecialCharacters: false,
    options: { timeout: 5000 },
  });
}

// Matches the BIR-style sales-invoice template on file (a real ASKI Multi-Purpose Cooperative
// receipt): store header, blank customer fields (POS captures no customer info today), one row
// per line item (barcode + name + amount, then an indented qty @ unit-price row), totals, cashier
// and terminal, then the VATable/VAT-Exempt/Zero-Rated breakdown. The store's TIN is registered
// NON VAT, so every sale is booked as VAT-Exempt and VAT is always 0 — see storeInfo.js if that
// ever needs to become per-product. "SI No" and "Tan No" both reuse AIMS's own transaction
// number/id rather than a separate BIR-sequential OR number, same convention as the Z-Reading's
// beginning/ending transaction numbers.
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
  const now = new Date();
  const itemCount = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const txnRef = data.transactionId ?? 'N/A';

  printer.alignCenter();
  printer.bold(true);
  printer.println(STORE_INFO.name);
  printer.bold(false);
  printer.println(STORE_INFO.addressLine1 + (STORE_INFO.addressLine2 ? `, ${STORE_INFO.addressLine2}` : ''));
  printer.println(`TIN ${STORE_INFO.tin}`);
  printer.newLine();

  printer.alignLeft();
  printer.println(`SI No: ${txnRef}`);
  printer.println(`Date-Time: ${now.toLocaleString()}`);
  printer.newLine();
  printer.println('Name:');
  printer.println('Address:');
  printer.println('TIN:');
  printer.drawLine();

  items.forEach((item) => {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unitPrice ?? item.price ?? 0) || 0;
    printer.tableCustom([
      { text: String(item.barcode || ''), align: 'LEFT', width: 0.3 },
      { text: String(item.name || 'Item').slice(0, 20), align: 'LEFT', width: 0.4 },
      { text: money(quantity * unitPrice), align: 'RIGHT', width: 0.3 },
    ]);
    printer.println(`   ${quantity} @ ${money(unitPrice)}`);
  });

  printer.drawLine();
  printer.println(`No. of Items: ${itemCount}`);
  printer.newLine();

  const discountAmount = Number(data.discountAmount) || 0;
  if (discountAmount > 0) {
    printer.tableCustom([
      { text: 'SUBTOTAL', align: 'LEFT', width: 0.6 },
      { text: money(data.subtotal ?? totalAmount + discountAmount), align: 'RIGHT', width: 0.4 },
    ]);
    printer.tableCustom([
      { text: 'DISCOUNT', align: 'LEFT', width: 0.6 },
      { text: money(discountAmount), align: 'RIGHT', width: 0.4 },
    ]);
  }
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
  printer.println(`Cashier ${data.cashier ?? 'N/A'}`);
  printer.println(`Terminal No: ${STORE_INFO.terminalNo}`);
  printer.newLine();
  printer.println(`Tan No ${txnRef}`);
  printer.println(`Date: ${now.toLocaleDateString()}`);
  printer.drawLine();

  // Store is registered NON VAT (see storeInfo.js) — every sale is booked as VAT-Exempt.
  printer.tableCustom([
    { text: 'VATable Sale (T)', align: 'LEFT', width: 0.6 },
    { text: money(0), align: 'RIGHT', width: 0.4 },
  ]);
  printer.tableCustom([
    { text: 'VAT-Exempt Sale (X)', align: 'LEFT', width: 0.6 },
    { text: money(totalAmount), align: 'RIGHT', width: 0.4 },
  ]);
  printer.tableCustom([
    { text: 'VAT Zero Rated Sale (Z)', align: 'LEFT', width: 0.6 },
    { text: money(0), align: 'RIGHT', width: 0.4 },
  ]);
  printer.tableCustom([
    { text: 'Total Sale', align: 'LEFT', width: 0.6 },
    { text: money(totalAmount), align: 'RIGHT', width: 0.4 },
  ]);
  printer.tableCustom([
    { text: 'VAT', align: 'LEFT', width: 0.6 },
    { text: money(0), align: 'RIGHT', width: 0.4 },
  ]);
  printer.bold(true);
  printer.tableCustom([
    { text: 'Total', align: 'LEFT', width: 0.6 },
    { text: money(totalAmount), align: 'RIGHT', width: 0.4 },
  ]);
  printer.bold(false);
  printer.newLine();

  printer.alignCenter();
  printer.bold(true);
  printer.println('THANK YOU!!!');
  printer.println('THIS SERVES AS AN OFFICIAL RECEIPT');
  printer.bold(false);
  printer.newLine();

  printer.println(STORE_INFO.posProviderName);
  printer.println(STORE_INFO.posProviderAddress);
  printer.println(`VAT-REG-TIN ${STORE_INFO.posProviderVatTin}`);
  printer.println(`ACCR # ${STORE_INFO.posProviderAccr}`);
  printer.println(`PTU DATE ${STORE_INFO.ptuDate}`);
  printer.println(`PTU Valid Until ${STORE_INFO.ptuValidUntil}`);
  printer.println(`PTUM: ${STORE_INFO.ptum}`);
  printer.newLine();
  printer.println('THIS INVOICE SHALL BE VALID FOR FIVE (5) YEARS');
  printer.println('FROM THE DATE OF THE PERMIT TO USE');
  printer.newLine();
  printer.cut();

  try {
    await printer.execute();
    console.log(`[receipt-printer] Printed receipt for txn ${txnRef}.`);
    return { printed: true };
  } catch (err) {
    console.error('[receipt-printer] Print failed:', err.message);
    return { printed: false, reason: 'error', error: err.message };
  }
}

const PAYMENT_LABELS = { CASH: 'CASH', CARD: 'CARD', E_wallet: 'E-WALLET' };

// Prints a cashier's Z-Reading — the supervisor-gated closing report built by
// models/ZReading.js. `report` is a ZReadingLog row (with its cashier/approvedBy relations).
async function printZReading(report = {}) {
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

  const payments = Array.isArray(report.paymentBreakdown) ? report.paymentBreakdown : [];
  const categories = Array.isArray(report.categoryBreakdown) ? report.categoryBreakdown : [];

  printer.alignCenter();
  printer.bold(true);
  printer.println(STORE_INFO.name);
  printer.bold(false);
  printer.println(`TIN #: ${STORE_INFO.tin}`);
  printer.println(`SN : ${STORE_INFO.sn}`);
  printer.println(STORE_INFO.addressLine1);
  printer.println(STORE_INFO.addressLine2);
  printer.newLine();

  printer.alignLeft();
  printer.println(`User : ${report.cashier?.fullName || report.cashier?.username || 'N/A'}`);
  printer.println(`${new Date(report.createdAt || Date.now()).toLocaleString()}`);
  printer.println(`TRANS NO : #${report.reportNo ?? 'N/A'}`);
  printer.newLine();

  printer.alignCenter();
  printer.bold(true);
  printer.println('Z-READING REPORT');
  printer.bold(false);
  printer.newLine();

  printer.alignLeft();
  printer.tableCustom([
    { text: 'GROSS', align: 'LEFT', width: 0.6 },
    { text: money(report.grossSales), align: 'RIGHT', width: 0.4 },
  ]);
  printer.tableCustom([
    { text: 'POINTS AVAILED', align: 'LEFT', width: 0.6 },
    { text: money(report.pointsAvailed), align: 'RIGHT', width: 0.4 },
  ]);
  printer.tableCustom([
    { text: 'TOTAL DISCOUNT', align: 'LEFT', width: 0.6 },
    { text: money(report.totalDiscount), align: 'RIGHT', width: 0.4 },
  ]);
  printer.newLine();
  printer.bold(true);
  printer.tableCustom([
    { text: 'NET', align: 'LEFT', width: 0.6 },
    { text: money(report.netSales), align: 'RIGHT', width: 0.4 },
  ]);
  printer.bold(false);
  printer.newLine();

  payments.forEach((p) => {
    printer.tableCustom([
      { text: String(p.count), align: 'LEFT', width: 0.2 },
      { text: PAYMENT_LABELS[p.method] || p.method, align: 'LEFT', width: 0.4 },
      { text: money(p.amount), align: 'RIGHT', width: 0.4 },
    ]);
  });

  printer.newLine();
  printer.alignCenter();
  printer.bold(true);
  printer.println('CATEGORY TOTAL');
  printer.bold(false);
  printer.alignLeft();
  categories.forEach((c) => {
    printer.tableCustom([
      { text: String(c.quantity), align: 'LEFT', width: 0.15 },
      { text: String(c.category).slice(0, 25), align: 'LEFT', width: 0.45 },
      { text: money(c.amount), align: 'RIGHT', width: 0.4 },
    ]);
  });

  printer.drawLine();
  printer.println(`BEGINNING TRANSACTION : ${report.beginTransactionNo || 'N/A'}`);
  printer.println(`ENDING TRANSACTION    : ${report.endTransactionNo || 'N/A'}`);
  printer.println(`OLD GRAND TOTAL : ${money(report.grandTotalBefore)}`);
  printer.println(`NEW GRAND TOTAL : ${money(report.grandTotalAfter)}`);
  printer.drawLine();

  printer.alignCenter();
  printer.bold(true);
  printer.println('***END OF REPORT***');
  printer.bold(false);
  printer.newLine();
  printer.cut();

  try {
    await printer.execute();
    console.log(`[receipt-printer] Printed Z-Reading ${report.reportNo ?? 'N/A'}.`);
    return { printed: true };
  } catch (err) {
    console.error('[receipt-printer] Z-Reading print failed:', err.message);
    return { printed: false, reason: 'error', error: err.message };
  }
}

// Denomination rows printed on the X-Reading, in the same order/values as the on-screen
// "Export X-Reading" sheet (frontend/src/utils/exportCsv.js) — this is that same report, just
// sent to the thermal printer instead of downloaded as a .xls file.
const DENOMINATION_ROWS = [
  { key: 'p1000', value: 1000, label: 'P 1,000.00' },
  { key: 'p500', value: 500, label: 'P   500.00' },
  { key: 'p200', value: 200, label: 'P   200.00' },
  { key: 'p100', value: 100, label: 'P   100.00' },
  { key: 'p50', value: 50, label: 'P    50.00' },
  { key: 'p20', value: 20, label: 'P    20.00' },
  { key: 'p10', value: 10, label: 'P    10.00' },
  { key: 'p5', value: 5, label: 'P     5.00' },
  { key: 'p1', value: 1, label: 'P     1.00' },
  { key: 'p0_50', value: 0.5, label: 'P     0.50' },
  { key: 'p0_25', value: 0.25, label: 'P     0.25' },
  { key: 'p0_10', value: 0.1, label: 'P     0.10' },
  { key: 'p0_05', value: 0.05, label: 'P     0.05' },
  { key: 'p0_01', value: 0.01, label: 'P     0.01' },
];

// Prints the cashier's X-Reading / end-of-day cash reconciliation — the same report the
// "Export X-Reading" button on the POS screen downloads as a spreadsheet (see exportCsv.js),
// printed instead so the cashier gets a paper copy without leaving the register. `record` is a
// Reconciliation row (models/Reconciliation.js) with its cashier relation included.
async function printXReading(record = {}) {
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

  const shortOver = Number(record.shortOver) || 0;

  printer.alignLeft();
  printer.println(new Date(record.createdAt || Date.now()).toLocaleDateString());
  printer.println(`TRANS NO : #${record.reportNo ?? 'N/A'}`);
  printer.newLine();

  printer.alignCenter();
  printer.bold(true);
  printer.println('X-READING REPORT');
  printer.bold(false);
  printer.drawLine();

  printer.alignLeft();
  printer.println(`Cashier : ${record.cashier?.username || 'N/A'}`);
  printer.drawLine();

  printer.tableCustom([
    { text: 'GROSS', align: 'LEFT', width: 0.6 },
    { text: money(record.grossSales), align: 'RIGHT', width: 0.4 },
  ]);
  printer.tableCustom([
    { text: 'POINTS AVAILED', align: 'LEFT', width: 0.6 },
    { text: money(record.pointsAvailed), align: 'RIGHT', width: 0.4 },
  ]);
  printer.tableCustom([
    { text: 'TOTAL DISCOUNT', align: 'LEFT', width: 0.6 },
    { text: money(record.totalDiscount), align: 'RIGHT', width: 0.4 },
  ]);
  printer.drawLine();

  printer.bold(true);
  printer.tableCustom([
    { text: 'NET', align: 'LEFT', width: 0.6 },
    { text: money(record.netSales), align: 'RIGHT', width: 0.4 },
  ]);
  printer.bold(false);
  printer.drawLine();

  printer.tableCustom([
    { text: 'CASH', align: 'LEFT', width: 0.6 },
    { text: money(record.posCash ?? record.netSales), align: 'RIGHT', width: 0.4 },
  ]);
  printer.drawLine();

  printer.alignCenter();
  printer.bold(true);
  printer.println('CASHIER ACCOUNTABILITY');
  printer.bold(false);
  printer.drawLine();

  printer.alignLeft();
  DENOMINATION_ROWS.forEach(({ key, value, label }) => {
    const count = parseInt(record[key], 10) || 0;
    printer.tableCustom([
      { text: String(count), align: 'LEFT', width: 0.2 },
      { text: label, align: 'CENTER', width: 0.4 },
      { text: money(count * value), align: 'RIGHT', width: 0.4 },
    ]);
  });
  printer.drawLine();

  printer.tableCustom([
    { text: 'TOTAL CASH', align: 'LEFT', width: 0.6 },
    { text: money(record.cashierCash), align: 'RIGHT', width: 0.4 },
  ]);
  printer.drawLine();

  printer.tableCustom([
    { text: 'POS CASH', align: 'LEFT', width: 0.6 },
    { text: money(record.posCash), align: 'RIGHT', width: 0.4 },
  ]);
  printer.tableCustom([
    { text: 'CASH DISC :', align: 'LEFT', width: 0.6 },
    { text: money(record.cashDiscount), align: 'RIGHT', width: 0.4 },
  ]);
  printer.tableCustom([
    { text: 'CASHIER CASH', align: 'LEFT', width: 0.6 },
    { text: money(record.cashierCash), align: 'RIGHT', width: 0.4 },
  ]);
  printer.bold(true);
  const shortOverTag = shortOver < 0 ? ' (SHORTAGE)' : shortOver > 0 ? ' (OVERAGE)' : '';
  printer.tableCustom([
    { text: 'SHORT/OVER', align: 'LEFT', width: 0.6 },
    { text: money(shortOver) + shortOverTag, align: 'RIGHT', width: 0.4 },
  ]);
  printer.bold(false);
  printer.drawLine();

  printer.alignCenter();
  printer.bold(true);
  printer.println('***END OF REPORT***');
  printer.bold(false);
  printer.newLine();
  printer.cut();

  try {
    await printer.execute();
    console.log(`[receipt-printer] Printed X-Reading ${record.reportNo ?? 'N/A'}.`);
    return { printed: true };
  } catch (err) {
    console.error('[receipt-printer] X-Reading print failed:', err.message);
    return { printed: false, reason: 'error', error: err.message };
  }
}

module.exports = { isConfigured, printReceipt, printXReading, printZReading };
