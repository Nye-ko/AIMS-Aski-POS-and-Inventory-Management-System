const ExcelJS = require('exceljs');
const { COMPANY } = require('./purchaseOrderExcel');

const THIN = { style: 'thin' };
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const LAVENDER = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFA9A6E8' } };
const money = (n) => Number(n || 0).toFixed(2);
const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Builds a workbook that mirrors the coop's official Purchase Return template layout
// (header, divider bar, supplier/return-info block, bordered item table, reason + totals footer).
async function buildPurchaseReturnWorkbook(pr) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Purchase Return', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
  });

  sheet.columns = [
    { width: 14 }, // A Barcode
    { width: 28 }, // B Description
    { width: 8 },  // C Qty.
    { width: 8 },  // D Unit
    { width: 11 }, // E Unit Price
    { width: 13 }, // F Amount
  ];

  let row = 1;

  // --- Header: coop name/address/tel on the left, "PURCHASE RETURN" title on the right ---
  sheet.mergeCells(`A${row}:D${row}`);
  sheet.getCell(`A${row}`).value = COMPANY.name;
  sheet.getCell(`A${row}`).font = { bold: true, size: 14 };
  sheet.mergeCells(`E${row}:F${row + 1}`);
  sheet.getCell(`E${row}`).value = 'PURCHASE\nRETURN';
  sheet.getCell(`E${row}`).font = { bold: true, size: 18 };
  sheet.getCell(`E${row}`).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
  row++;

  sheet.mergeCells(`A${row}:D${row}`);
  sheet.getCell(`A${row}`).value = COMPANY.address;
  row++;

  sheet.mergeCells(`A${row}:D${row}`);
  sheet.getCell(`A${row}`).value = `Tel no.:    ${COMPANY.tel}`;
  row += 1;

  // --- Divider bar ---
  sheet.mergeCells(`A${row}:F${row}`);
  sheet.getCell(`A${row}`).fill = LAVENDER;
  sheet.getRow(row).height = 6;
  row += 2;

  // --- Supplier block (left) / PR No. / PR Date / Terms (right) ---
  const infoStart = row;
  const supplierRows = [
    ['Supplier Name :', pr.supplier?.name || ''],
    ['Address :', pr.supplier?.address || '-'],
    ['Contact Person :', pr.supplier?.contactPerson || '-'],
    ['Contact No :', pr.supplier?.phone || '-'],
  ];
  const prInfoRows = [
    ['PR No. :', pr.returnNo],
    ['PR Date :', fmtDate(pr.createdAt)],
    ['Terms :', pr.terms || 'N/A'],
  ];
  supplierRows.forEach(([label, value], i) => {
    sheet.getCell(`A${row}`).value = label;
    sheet.getCell(`A${row}`).font = { bold: true };
    sheet.mergeCells(`B${row}:D${row}`);
    sheet.getCell(`B${row}`).value = value;

    const prInfo = prInfoRows[i];
    if (prInfo) {
      sheet.getCell(`E${row}`).value = prInfo[0];
      sheet.getCell(`E${row}`).font = { bold: true };
      sheet.getCell(`F${row}`).value = prInfo[1];
    }
    row++;
  });
  for (let r = infoStart; r <= row - 1; r++) {
    sheet.getRow(r).eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (colNumber >= 1 && colNumber <= 6) cell.border = BOX;
    });
  }
  row++;

  // --- Item table header ---
  const tableHeaderRow = row;
  const headers = ['Barcode', 'Description', 'Qty.', 'Unit', 'Unit Price', 'Amount'];
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
  let totalAmount = 0;

  pr.items.forEach((item) => {
    const qty = item.quantity;
    const unitCost = Number(item.unitCost);
    const subtotal = Number(item.subtotal);

    totalQty += qty;
    totalAmount += subtotal;

    const values = [
      item.product?.barcode || '',
      item.product?.name || '',
      qty,
      item.product?.unit || 'PC/S',
      money(unitCost),
      money(subtotal),
    ];
    values.forEach((v, i) => {
      const cell = sheet.getCell(row, i + 1);
      cell.value = v;
      cell.border = BOX;
      if (i >= 2) cell.alignment = { horizontal: i === 3 ? 'center' : 'right' };
    });
    row++;
  });

  const lessDiscount = 0;
  const addAdjustment = 0;
  const netAmount = Number((totalAmount - lessDiscount + addAdjustment).toFixed(2));

  // --- Footer: Reason for Return on the left, totals on the right ---
  const footerStart = row;
  sheet.mergeCells(`A${row}:D${row}`);
  sheet.getCell(`A${row}`).value = 'REASON FOR RETURN';
  sheet.getCell(`A${row}`).font = { bold: true };
  sheet.getCell(`A${row}`).fill = LAVENDER;
  sheet.getCell(`A${row}`).alignment = { horizontal: 'center' };

  const totalsRows = [
    ['TOTAL QUANTITY', totalQty],
    ['TOTAL AMOUNT', money(totalAmount)],
    ['LESS: DISCOUNT', money(lessDiscount)],
    ['ADD: ADJUSTMENT', money(addAdjustment)],
    ['NET AMOUNT', money(netAmount)],
  ];
  sheet.getCell(`E${row}`).value = totalsRows[0][0];
  sheet.getCell(`E${row}`).font = { bold: true };
  sheet.getCell(`F${row}`).value = totalsRows[0][1];
  sheet.getCell(`F${row}`).alignment = { horizontal: 'right' };
  row++;

  sheet.mergeCells(`A${row}:D${row}`);
  sheet.getCell(`A${row}`).value = pr.reason || '';
  sheet.getCell(`A${row}`).alignment = { horizontal: 'center' };

  for (let i = 1; i < totalsRows.length; i++) {
    sheet.getCell(`E${row}`).value = totalsRows[i][0];
    sheet.getCell(`E${row}`).font = { bold: true };
    sheet.getCell(`F${row}`).value = totalsRows[i][1];
    sheet.getCell(`F${row}`).alignment = { horizontal: 'right' };
    row++;
  }

  for (let r = footerStart; r <= row - 1; r++) {
    sheet.getRow(r).eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (colNumber >= 1 && colNumber <= 6) cell.border = BOX;
    });
  }

  // --- Remarks ---
  sheet.getCell(`A${row}`).value = 'REMARKS :';
  sheet.getCell(`A${row}`).font = { bold: true };
  sheet.mergeCells(`B${row}:F${row}`);
  sheet.getCell(`B${row}`).value = pr.remarks || '-';

  return workbook;
}

module.exports = { buildPurchaseReturnWorkbook };
