const ExcelJS = require('exceljs');
const { VAT_RATE } = require('../models/PurchaseOrder');
const { COMPANY } = require('./purchaseOrderExcel');

const THIN = { style: 'thin' };
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const money = (n) => Number(n || 0).toFixed(2);
const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Builds a workbook that mirrors the coop's official Receiving Report template layout
// (header, divider bar, received-from/report-info block, bordered item table, totals, signatures).
async function buildReceivingReportWorkbook(rr) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Receiving Report', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
  });

  sheet.columns = [
    { width: 14 }, // A Barcode
    { width: 28 }, // B Description
    { width: 8 },  // C Qty.
    { width: 8 },  // D Unit
    { width: 11 }, // E Unit Price
    { width: 10 }, // F Vat
    { width: 10 }, // G Discount
    { width: 13 }, // H Amount
  ];

  let row = 1;

  // --- Header: coop name/address/tel on the left, "RECEIVING REPORT" title on the right ---
  sheet.mergeCells(`A${row}:E${row}`);
  sheet.getCell(`A${row}`).value = COMPANY.name;
  sheet.getCell(`A${row}`).font = { bold: true, size: 14 };
  sheet.mergeCells(`F${row}:H${row + 1}`);
  sheet.getCell(`F${row}`).value = 'RECEIVING\nREPORT';
  sheet.getCell(`F${row}`).font = { bold: true, size: 18 };
  sheet.getCell(`F${row}`).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
  row++;

  sheet.mergeCells(`A${row}:E${row}`);
  sheet.getCell(`A${row}`).value = COMPANY.address;
  row++;

  sheet.mergeCells(`A${row}:E${row}`);
  sheet.getCell(`A${row}`).value = `Tel no.:    ${COMPANY.tel}`;
  row += 1;

  // --- Divider bar ---
  sheet.mergeCells(`A${row}:H${row}`);
  sheet.getCell(`A${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFA9A6E8' } };
  sheet.getRow(row).height = 6;
  row += 2;

  // --- Received From / Receiving No. / Date Received / Terms / DR Number / Invoice No. box ---
  const infoStart = row;
  sheet.getCell(`A${row}`).value = 'Received From:';
  sheet.getCell(`A${row}`).font = { bold: true };
  sheet.getCell(`F${row}`).value = 'Receiving No. :';
  sheet.getCell(`F${row}`).font = { bold: true };
  sheet.mergeCells(`G${row}:H${row}`);
  sheet.getCell(`G${row}`).value = rr.rrNumber;
  row++;

  sheet.getCell(`A${row}`).value = rr.supplier?.name || '';
  sheet.getCell(`F${row}`).value = 'Date Received :';
  sheet.getCell(`F${row}`).font = { bold: true };
  sheet.mergeCells(`G${row}:H${row}`);
  sheet.getCell(`G${row}`).value = fmtDate(rr.receivedAt);
  row++;

  sheet.getCell(`F${row}`).value = 'Terms :';
  sheet.getCell(`F${row}`).font = { bold: true };
  sheet.mergeCells(`G${row}:H${row}`);
  sheet.getCell(`G${row}`).value = rr.terms || 'N/A';
  row++;

  sheet.getCell(`F${row}`).value = 'DR Number :';
  sheet.getCell(`F${row}`).font = { bold: true };
  sheet.mergeCells(`G${row}:H${row}`);
  sheet.getCell(`G${row}`).value = rr.deliveryNote || '-';
  row++;

  sheet.getCell(`F${row}`).value = 'Invoice No.';
  sheet.getCell(`F${row}`).font = { bold: true };
  sheet.mergeCells(`G${row}:H${row}`);
  sheet.getCell(`G${row}`).value = rr.invoiceNo || '-';
  row++;

  for (let r = infoStart; r <= row - 1; r++) {
    sheet.getRow(r).eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (colNumber >= 1 && colNumber <= 8) cell.border = BOX;
    });
  }
  row++;

  // --- Item table header ---
  const tableHeaderRow = row;
  const headers = ['Barcode', 'Description', 'Qty.', 'Unit', 'Unit Price', 'Vat', 'Discount', 'Amount'];
  headers.forEach((h, i) => {
    const cell = sheet.getCell(tableHeaderRow, i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center', wrapText: true };
    cell.border = BOX;
  });
  row++;

  // --- Item rows ---
  let totalQty = 0;
  let totalSubtotal = 0;
  let totalVat = 0;

  rr.items.forEach((item) => {
    const qty = item.quantity;
    const unitCost = Number(item.unitCost);
    const subtotal = Number(item.subtotal);
    const vat = Number((subtotal * VAT_RATE).toFixed(2));
    const discount = 0;
    const amount = Number((subtotal + vat - discount).toFixed(2));

    totalQty += qty;
    totalSubtotal += subtotal;
    totalVat += vat;

    const values = [
      item.product?.barcode || '',
      item.product?.name || '',
      qty,
      item.product?.unit || 'PC/S',
      money(unitCost),
      money(vat),
      money(discount),
      money(amount),
    ];
    values.forEach((v, i) => {
      const cell = sheet.getCell(row, i + 1);
      cell.value = v;
      cell.border = BOX;
      if (i >= 2) cell.alignment = { horizontal: i === 3 ? 'center' : 'right' };
    });
    row++;
  });

  const grossAmount = Number((totalSubtotal + totalVat).toFixed(2));
  const lineDiscount = 0;
  const lessDiscount = 0;
  const netAmount = Number((grossAmount - lessDiscount).toFixed(2));

  // --- Footer: totals ---
  const footerStart = row;
  const totalsRows = [
    ['TOTAL QUANTITY', totalQty],
    ['TOTAL VAT', money(totalVat)],
    ['GROSS AMOUNT', money(grossAmount)],
    ['LINE DISCOUNT', money(lineDiscount)],
    ['LESS: DISCOUNT', money(lessDiscount)],
    ['NET AMOUNT', money(netAmount)],
  ];
  totalsRows.forEach(([label, value]) => {
    sheet.getCell(`F${row}`).value = label;
    sheet.getCell(`F${row}`).font = { bold: true };
    sheet.mergeCells(`G${row}:G${row}`);
    sheet.getCell(`H${row}`).value = value;
    sheet.getCell(`H${row}`).alignment = { horizontal: 'right' };
    row++;
  });
  for (let r = footerStart; r <= row - 1; r++) {
    sheet.getRow(r).eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (colNumber >= 1 && colNumber <= 8) cell.border = BOX;
    });
  }
  row++;

  // --- Remarks ---
  sheet.getCell(`A${row}`).value = 'REMARKS :';
  sheet.getCell(`A${row}`).font = { bold: true };
  sheet.mergeCells(`B${row}:H${row}`);
  sheet.getCell(`B${row}`).value = rr.remarks || '-';
  row += 2;

  // --- Signature lines ---
  sheet.mergeCells(`A${row}:B${row}`);
  sheet.getCell(`A${row}`).value = 'Prepared by:';
  sheet.mergeCells(`C${row}:E${row}`);
  sheet.getCell(`C${row}`).value = 'Checked by:';
  sheet.mergeCells(`F${row}:H${row}`);
  sheet.getCell(`F${row}`).value = 'Received by:';
  row++;
  sheet.mergeCells(`A${row}:B${row}`);
  sheet.getCell(`A${row}`).border = { top: THIN };
  sheet.mergeCells(`C${row}:E${row}`);
  sheet.getCell(`C${row}`).border = { top: THIN };
  sheet.mergeCells(`F${row}:H${row}`);
  sheet.getCell(`F${row}`).border = { top: THIN };
  row++;
  sheet.mergeCells(`F${row}:H${row}`);
  sheet.getCell(`F${row}`).value = rr.receivedBy?.username || '';
  sheet.getCell(`F${row}`).alignment = { horizontal: 'center' };

  return workbook;
}

module.exports = { buildReceivingReportWorkbook };
