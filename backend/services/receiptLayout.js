// One description of a printout, rendered two ways: to the thermal printer (ESC/POS via
// node-thermal-printer) and to plain text for on-screen previews — so a preview always matches
// the paper character for character.
//
// Column widths are whole characters that add up to exactly WIDTH. node-thermal-printer's own
// fractional `width` option rounds each cell up, producing 49–50 character rows on a 48-column
// printer, which pushes the last characters of every price row onto the next line.
const { STORE_INFO } = require('../config/storeInfo');

const WIDTH = parseInt(process.env.RECEIPT_PRINTER_WIDTH, 10) || 48; // 80mm paper, font A
const TIME_ZONE = process.env.STORE_TIMEZONE || process.env.TZ || 'Asia/Manila';

const dateTimeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});
const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric' });
const fmtDateTime = (d) => dateTimeFmt.format(new Date(d));
const fmtDate = (d) => dateFmt.format(new Date(d));

const money = (value) => `P${(Number(value) || 0).toFixed(2)}`;

// Cells given as fractions of the line (`w`) become whole character counts; the last cell takes
// whatever rounding left over so the row is exactly WIDTH.
const toCols = (cells) => {
  let used = 0;
  return cells.map((c, i) => {
    const cols = i === cells.length - 1 ? WIDTH - used : Math.floor(WIDTH * (c.w ?? c.width));
    used += cols;
    return { text: String(c.text ?? ''), align: c.align || 'LEFT', cols };
  });
};

const text = (t, opts = {}) => ({ kind: 'text', text: String(t ?? ''), align: opts.align || 'LEFT', bold: !!opts.bold });
const center = (t, opts = {}) => text(t, { ...opts, align: 'CENTER' });
const row = (cells, opts = {}) => ({ kind: 'cols', cells: toCols(cells), bold: !!opts.bold });
const pair = (label, value, opts = {}) => row([{ text: label, w: 0.6 }, { text: value, align: 'RIGHT', w: 0.4 }], opts);
const rule = () => ({ kind: 'rule' });
const blank = () => ({ kind: 'blank' });

// ---------------------------------------------------------------- renderers

function renderToPrinter(printer, lines) {
  for (const line of lines) {
    if (line.kind === 'rule') {
      printer.drawLine();
    } else if (line.kind === 'blank') {
      printer.newLine();
    } else if (line.kind === 'cols') {
      if (line.bold) printer.bold(true);
      printer.tableCustom(line.cells.map((c) => ({ ...c })));
      if (line.bold) printer.bold(false);
    } else {
      if (line.align === 'CENTER') printer.alignCenter();
      if (line.bold) printer.bold(true);
      printer.println(line.text);
      if (line.bold) printer.bold(false);
      if (line.align === 'CENTER') printer.alignLeft();
    }
  }
}

// node-thermal-printer pads with `for (j = 0; j < n; j++)`, i.e. ceil(n) spaces for n > 0.
const pad = (n) => ' '.repeat(n > 0 ? Math.ceil(n) : 0);

// Mirrors node-thermal-printer's tableCustom for whole-character columns, including how an
// over-long cell is cut one short and continued on a following row.
function colsToText(cells) {
  const out = [];
  let current = cells;
  for (;;) {
    let line = '';
    let overflow = false;
    const next = current.map((c) => {
      let t = c.text;
      let rest = '';
      if (c.cols < t.length) {
        overflow = true;
        rest = t.substring(c.cols - 1);
        t = t.substring(0, c.cols - 1);
      }
      const spaces = c.cols - t.length;
      if (c.align === 'CENTER') line += pad(spaces / 2) + t + pad(spaces / 2 - 1);
      else if (c.align === 'RIGHT') line += pad(spaces) + t;
      else line += t + pad(spaces);
      return { ...c, text: rest };
    });
    out.push(line);
    if (!overflow) return out;
    current = next;
  }
}

// Word-wraps the way node-thermal-printer's println does (break after the last space that fits).
function foldText(t) {
  const out = [];
  for (let current of String(t).split('\n')) {
    while (current.length > WIDTH) {
      let piece = current.substring(0, WIDTH);
      let nextIdx = WIDTH;
      const idx = piece.search(/\s(?!.*\s)/);
      if (idx > 0) {
        piece = piece.substring(0, idx);
        nextIdx = idx + 1;
      }
      out.push(piece);
      current = current.substring(nextIdx);
    }
    if (current.length > 0) out.push(current);
  }
  return out.length ? out : [''];
}

// Plain-text version for on-screen previews: [{ text, bold }], each at most WIDTH characters.
function renderToText(lines) {
  const out = [];
  for (const line of lines) {
    if (line.kind === 'rule') out.push({ text: '-'.repeat(WIDTH), bold: false });
    else if (line.kind === 'blank') out.push({ text: '', bold: false });
    else if (line.kind === 'cols') colsToText(line.cells).forEach((t) => out.push({ text: t, bold: line.bold }));
    else {
      foldText(line.text).forEach((t) => {
        const centered = line.align === 'CENTER' ? ' '.repeat(Math.max(0, Math.floor((WIDTH - t.length) / 2))) + t : t;
        out.push({ text: centered, bold: line.bold });
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- layouts

// The BIR-style sales invoice (template: a real ASKI Multi-Purpose Cooperative receipt). The store
// is registered NON VAT, so every sale is booked as VAT-Exempt with 0 VAT. "SI No" and "Tan No"
// both use AIMS's own transaction number. `reprintedAt` marks a copy printed after the fact.
function buildSaleReceipt(sale, { reprintedAt } = {}) {
  const items = Array.isArray(sale.items) ? sale.items : [];
  const totalAmount = Number(sale.totalAmount) || 0;
  const discountAmount = Number(sale.discountAmount) || 0;
  const amountPaid = Number(sale.amountPaid ?? totalAmount) || 0;
  const soldAt = sale.createdAt || new Date();
  const txnRef = sale.transactionNo ?? 'N/A';
  const itemCount = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

  const lines = [
    center(STORE_INFO.name, { bold: true }),
    center(STORE_INFO.addressLine1 + (STORE_INFO.addressLine2 ? `, ${STORE_INFO.addressLine2}` : '')),
    center(`TIN ${STORE_INFO.tin}`),
    blank(),
  ];
  if (reprintedAt) lines.push(center('*** REPRINT ***', { bold: true }), blank());
  // A reprint of a sale that was later voided must not pass as proof of purchase.
  if (sale.voidNo) lines.push(center(`*** VOIDED - ${sale.voidNo} ***`, { bold: true }), blank());
  lines.push(
    text(`SI No: ${txnRef}`),
    text(`Date-Time: ${fmtDateTime(soldAt)}`),
    blank(),
    text('Name:'),
    text('Address:'),
    text('TIN:'),
    rule(),
  );

  // "barcode name ... amount" on one row like the template; barcode + name share one column and are
  // cut to fit (one space kept before the amount) so a long name never spills onto a second row.
  const amountCols = Math.floor(WIDTH * 0.25);
  const descCols = WIDTH - amountCols;
  for (const item of items) {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unitPrice ?? item.price ?? 0) || 0;
    const desc = `${item.barcode || ''} ${item.name || 'Item'}`.trim().slice(0, descCols - 1);
    lines.push(
      { kind: 'cols', bold: false, cells: [{ text: desc, align: 'LEFT', cols: descCols }, { text: money(quantity * unitPrice), align: 'RIGHT', cols: amountCols }] },
      text(`   ${quantity} @ ${money(unitPrice)}`),
    );
  }

  lines.push(rule(), text(`No. of Items: ${itemCount}`), blank());
  if (discountAmount > 0) {
    lines.push(pair('SUBTOTAL', money(sale.subtotal ?? totalAmount + discountAmount)), pair('DISCOUNT', money(discountAmount)));
  }
  lines.push(pair('TOTAL', money(totalAmount), { bold: true }));
  if (String(sale.paymentMethod || '').toUpperCase() === 'CASH') {
    lines.push(pair('CASH', money(amountPaid)), pair('CHANGE', money(Math.max(0, amountPaid - totalAmount))));
  } else if (sale.referenceNumber) {
    lines.push(text(`Ref #: ${sale.referenceNumber}`));
  }

  lines.push(
    rule(),
    text(`Cashier ${sale.cashier ?? 'N/A'}`),
    text(`Terminal No: ${STORE_INFO.terminalNo}`),
    blank(),
    text(`Tan No ${txnRef}`),
    text(`Date: ${fmtDate(soldAt)}`),
    rule(),
    pair('VATable Sale (T)', money(0)),
    pair('VAT-Exempt Sale (X)', money(totalAmount)),
    pair('VAT Zero Rated Sale (Z)', money(0)),
    pair('Total Sale', money(totalAmount)),
    pair('VAT', money(0)),
    pair('Total', money(totalAmount), { bold: true }),
    blank(),
    center('THANK YOU!!!', { bold: true }),
    center('THIS SERVES AS AN OFFICIAL RECEIPT', { bold: true }),
    blank(),
    center(STORE_INFO.posProviderName),
    center(STORE_INFO.posProviderAddress),
    center(`VAT-REG-TIN ${STORE_INFO.posProviderVatTin}`),
    center(`ACCR # ${STORE_INFO.posProviderAccr}`),
    center(`PTU DATE ${STORE_INFO.ptuDate}`),
    center(`PTU Valid Until ${STORE_INFO.ptuValidUntil}`),
    center(`PTUM: ${STORE_INFO.ptum}`),
    blank(),
    center('THIS INVOICE SHALL BE VALID FOR FIVE (5) YEARS'),
    center('FROM THE DATE OF THE PERMIT TO USE'),
  );
  if (reprintedAt) lines.push(blank(), center(`Reprinted: ${fmtDateTime(reprintedAt)}`));
  lines.push(blank());
  return lines;
}

// The void slip, laid out from the store's template: header, "*** VOID RECEIPT ***", who/when,
// the voided items, the amounts taken back, the reason, and a not-an-invoice footer. `v` is
// SaleVoidModel.findReceiptData's shape.
function buildVoidReceipt(v, { reprintedAt } = {}) {
  const field = (label, value) => text(`${label.padEnd(10)} : ${value}`);
  const discount = Number(v.discountAmount) || 0;
  const lines = [
    center(STORE_INFO.name, { bold: true }),
    center(`TIN # : ${STORE_INFO.tin}`),
    center(`SN : ${STORE_INFO.sn}`),
    center(STORE_INFO.addressLine1),
    center(STORE_INFO.addressLine2),
    blank(),
    center('*** VOID RECEIPT ***', { bold: true }),
  ];
  if (reprintedAt) lines.push(center('*** REPRINT ***', { bold: true }));
  lines.push(
    blank(),
    field('Void No', v.voidNo),
    field('Voided TXN', v.transactionNo),
    field('Original', fmtDateTime(v.soldAt)),
    field('Voided at', fmtDateTime(v.voidedAt)),
    field('Cashier', v.cashier),
    field('Voided by', v.voidedBy),
    field('Approver', v.approver),
  );
  if (v.member) lines.push(field('Member', `${v.member.name} (#${v.member.cardNumber})`));
  lines.push(rule());

  for (const item of v.items || []) {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unitPrice) || 0;
    lines.push(text(item.name || 'Item'), pair(`  ${quantity} @ ${money(unitPrice)}`, money(quantity * unitPrice)));
  }

  lines.push(
    rule(),
    pair('SUBTOTAL', money(v.subtotal)),
    pair('DISCOUNT', discount > 0 ? `-${money(discount)}` : money(0)),
    pair('VOIDED TOTAL', `-${money(v.totalAmount)}`, { bold: true }),
    rule(),
    text('Reason:'),
    text(v.reason || '-'),
    rule(),
    center('Stock has been restored to inventory.'),
    center('This receipt is NOT an official sales invoice.'),
    blank(),
    center('*** END OF VOID ***', { bold: true }),
  );
  if (reprintedAt) lines.push(center(`Reprinted: ${fmtDateTime(reprintedAt)}`));
  lines.push(blank());
  return lines;
}

module.exports = { WIDTH, toCols, money, fmtDateTime, fmtDate, renderToPrinter, renderToText, buildSaleReceipt, buildVoidReceipt };
