const ExcelJS = require('exceljs');
const { VAT_RATE } = require('../models/PurchaseOrder');

// The coop's own info — this is always "Ship To" on a Purchase Order, since we're the buyer.
const COMPANY = {
  name: 'ASKI MULTI-PURPOSE COOPERATIVE',
  address: '#135 BARANGAY ANDAL ALIÑO, TALAVERA NUEVA ECIJA',
  tel: '958-1011',
};

const THIN = { style: 'thin' };
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const money = (n) => Number(n || 0).toFixed(2);
const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Builds a workbook that mirrors the coop's official Purchase Order template layout
// (header, divider bar, supplier/ship-to block, bordered item table, totals, signatures).
async function buildPurchaseOrderWorkbook(po) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Purchase Order', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
  });

  sheet.columns = [
    { width: 14 }, // A Barcode
    { width: 28 }, // B Description
    { width: 8 },  // C Qty.
    { width: 8 },  // D Unit
    { width: 11 }, // E Unit Price
    { width: 12 }, // F Total Price
    { width: 9 },  // G Vat
    { width: 11 }, // H Total Vat
    { width: 13 }, // I Total Amount
  ];

  let row = 1;

  // --- Header: coop name/address/tel on the left, "PURCHASE ORDER" title on the right ---
  sheet.mergeCells(`A${row}:E${row}`);
  sheet.getCell(`A${row}`).value = COMPANY.name;
  sheet.getCell(`A${row}`).font = { bold: true, size: 14 };
  sheet.mergeCells(`F${row}:I${row + 1}`);
  sheet.getCell(`F${row}`).value = 'PURCHASE\nORDER';
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
  sheet.mergeCells(`A${row}:I${row}`);
  sheet.getCell(`A${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFA9A6E8' } };
  sheet.getRow(row).height = 6;
  row += 2;

  // --- PO number / date / terms box ---
  const infoStart = row;
  sheet.mergeCells(`A${row}:E${row + 2}`);
  sheet.getCell(`A${row}`).value =
    'The following number must appear on all invoices, bill of\nand acknowledgements relating to this PO:\nPURCHASE ORDER:';
  sheet.getCell(`A${row}`).alignment = { wrapText: true, vertical: 'top' };

  sheet.getCell(`F${row}`).value = 'PO no.';
  sheet.getCell(`F${row}`).font = { bold: true };
  sheet.mergeCells(`G${row}:I${row}`);
  sheet.getCell(`G${row}`).value = po.poNumber;
  row++;

  sheet.getCell(`F${row}`).value = 'PO Date';
  sheet.getCell(`F${row}`).font = { bold: true };
  sheet.mergeCells(`G${row}:I${row}`);
  sheet.getCell(`G${row}`).value = fmtDate(po.createdAt);
  row++;

  sheet.getCell(`F${row}`).value = 'Terms';
  sheet.getCell(`F${row}`).font = { bold: true };
  sheet.mergeCells(`G${row}:I${row}`);
  sheet.getCell(`G${row}`).value = po.terms || 'N/A';
  row++;

  for (let r = infoStart; r <= row - 1; r++) {
    sheet.getRow(r).eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (colNumber >= 1 && colNumber <= 9) cell.border = BOX;
    });
  }
  row++;

  // --- Supplier / Ship To block ---
  const supplierStart = row;
  const supplierRows = [
    ['Supplier Name :', po.supplier?.name || '', 'Ship To :', po.shipTo || COMPANY.name],
    ['Address :', po.supplier?.address || '-', 'Address :', po.shippingAddress || COMPANY.address],
    ['Contact Person :', po.supplier?.contactPerson || '-', '', ''],
    ['Contact No. :', po.supplier?.phone || '-', '', ''],
  ];
  supplierRows.forEach(([labelA, valueA, labelB, valueB]) => {
    sheet.getCell(`A${row}`).value = labelA;
    sheet.getCell(`A${row}`).font = { bold: true };
    sheet.mergeCells(`B${row}:E${row}`);
    sheet.getCell(`B${row}`).value = valueA;
    if (labelB) {
      sheet.getCell(`F${row}`).value = labelB;
      sheet.getCell(`F${row}`).font = { bold: true };
      sheet.mergeCells(`G${row}:I${row}`);
      sheet.getCell(`G${row}`).value = valueB;
    }
    row++;
  });
  for (let r = supplierStart; r <= row - 1; r++) {
    sheet.getRow(r).eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (colNumber >= 1 && colNumber <= 9) cell.border = BOX;
    });
  }
  row++;

  // --- Item table header ---
  const tableHeaderRow = row;
  const headers = ['Barcode', 'Description', 'Qty.', 'Unit', 'Unit Price', 'Total Price', 'Vat', 'Total Vat', 'Total Amount'];
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
  let totalPrice = 0;
  let totalVat = 0;

  po.items.forEach((item) => {
    const qty = item.quantity;
    const unitCost = Number(item.unitCost);
    const subtotal = Number(item.subtotal);
    const vat = Number((subtotal * VAT_RATE).toFixed(2));

    totalQty += qty;
    totalPrice += subtotal;
    totalVat += vat;

    const values = [
      item.product?.barcode || '',
      item.product?.name || '',
      qty,
      item.product?.unit || 'PC/S',
      money(unitCost),
      money(subtotal),
      money(vat),
      money(vat),
      money(subtotal + vat),
    ];
    values.forEach((v, i) => {
      const cell = sheet.getCell(row, i + 1);
      cell.value = v;
      cell.border = BOX;
      if (i >= 2) cell.alignment = { horizontal: i === 3 ? 'center' : 'right' };
    });
    row++;
  });

  const totalAmount = Number((totalPrice + totalVat).toFixed(2));
  const discount = Number(po.discount || 0);
  const netAmount = Number((totalAmount - discount).toFixed(2));

  // --- Footer: notify note on the left, totals on the right ---
  const footerStart = row;
  sheet.mergeCells(`A${row}:E${row + 5}`);
  sheet.getCell(`A${row}`).value =
    'Please notify us immediately if this order\ncannot be shipped complete on or before:';
  sheet.getCell(`A${row}`).alignment = { wrapText: true, vertical: 'top' };

  const totalsRows = [
    ['TOTAL QUANTITY', totalQty],
    ['TOTAL VAT', money(totalVat)],
    ['TOTAL PRICE', money(totalPrice)],
    ['TOTAL AMOUNT', money(totalAmount)],
    ['LESS: DISCOUNT', money(discount)],
    ['NET AMOUNT', money(netAmount)],
  ];
  totalsRows.forEach(([label, value]) => {
    sheet.getCell(`F${row}`).value = label;
    sheet.getCell(`F${row}`).font = { bold: true };
    sheet.mergeCells(`G${row}:H${row}`);
    sheet.getCell(`I${row}`).value = value;
    sheet.getCell(`I${row}`).alignment = { horizontal: 'right' };
    row++;
  });
  for (let r = footerStart; r <= row - 1; r++) {
    sheet.getRow(r).eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (colNumber >= 1 && colNumber <= 9) cell.border = BOX;
    });
  }
  row++;

  // --- Remarks ---
  sheet.getCell(`A${row}`).value = 'REMARKS :';
  sheet.getCell(`A${row}`).font = { bold: true };
  sheet.mergeCells(`B${row}:I${row}`);
  sheet.getCell(`B${row}`).value =
    [po.tagging && po.tagging !== 'Regular' ? `[${po.tagging}]` : '', po.purpose, po.remarks].filter(Boolean).join(' ') || '-';
  row += 2;

  // --- Signature lines ---
  sheet.mergeCells(`A${row}:D${row}`);
  sheet.getCell(`A${row}`).value = 'Prepared by:';
  sheet.mergeCells(`F${row}:I${row}`);
  sheet.getCell(`F${row}`).value = 'Approved by:';
  row++;
  sheet.mergeCells(`A${row}:D${row}`);
  sheet.getCell(`A${row}`).border = { top: THIN };
  sheet.mergeCells(`F${row}:I${row}`);
  sheet.getCell(`F${row}`).border = { top: THIN };
  row++;
  sheet.mergeCells(`A${row}:D${row}`);
  sheet.getCell(`A${row}`).value = po.preparedBy || '';
  sheet.getCell(`A${row}`).alignment = { horizontal: 'center' };

  return workbook;
}

module.exports = { buildPurchaseOrderWorkbook, COMPANY };
