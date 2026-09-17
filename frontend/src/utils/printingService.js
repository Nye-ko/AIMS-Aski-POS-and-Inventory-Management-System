/**
 * Prints a sales receipt to the browser print dialog.
 * @param {Object} receiptData - Transaction data
 * @param {string} printerWidth - '80mm' or '58mm'
 */
/**
 * Prints a daily X-reading reconciliation report for a thermal printer.
 * @param {Object} reportData - Reconciliation details
 * @param {string} printerWidth - '80mm' or '58mm'
 */
export const printThermalReceipt = (receiptData = {}, printerWidth = '80mm') => {
  const pageWidth = printerWidth === '80mm' ? '80mm' : '58mm';
  const charsPerLine = printerWidth === '80mm' ? 42 : 32;
  const items = Array.isArray(receiptData.items) ? receiptData.items : [];
  const totalAmount = Number(receiptData.totalAmount) || 0;
  const amountPaid = Number(receiptData.amountPaid) || 0;
  const change = Math.max(0, amountPaid - totalAmount);

  const pad = (value, length, right = false) => {
    const text = String(value ?? '');
    return right ? text.padStart(length, ' ') : text.padEnd(length, ' ');
  };
  const center = (value) => {
    const text = String(value ?? '');
    return ' '.repeat(Math.max(0, Math.floor((charsPerLine - text.length) / 2))) + text;
  };
  const divider = (character = '-') => character.repeat(charsPerLine);
  const money = (value) => `₱${(Number(value) || 0).toFixed(2)}`;

  let receipt = '';
  receipt += center('ASKI MULTI-PURPOSE COOPERATIVE') + '\n';
  receipt += center('Barangay Andal Alia?o, Talisay City') + '\n';
  receipt += center('TIN: 000-000-000-000') + '\n\n';
  receipt += `Txn No.: ${receiptData.transactionId || 'N/A'}\n`;
  receipt += `Date: ${new Date().toLocaleDateString()}\n`;
  receipt += `Time: ${new Date().toLocaleTimeString()}\n`;
  receipt += `Cashier: ${receiptData.cashierName || receiptData.cashier || 'N/A'}\n\n`;
  receipt += divider('=') + '\n';

  items.forEach((item) => {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unitPrice ?? item.price ?? 0) || 0;
    const itemName = String(item.name || 'Item').substring(0, 18);
    const lineTotal = quantity * unitPrice;
    receipt += pad(itemName, 18) + pad(String(quantity), 4, true) + pad(money(lineTotal), 14, true) + '\n';
    receipt += `@ ${money(unitPrice)}\n`;
  });

  receipt += divider('=') + '\n';
  receipt += pad('SUBTOTAL', 24) + pad(money(receiptData.subtotal ?? totalAmount), 16, true) + '\n';
  receipt += pad('DISCOUNT', 24) + pad(money(receiptData.discountAmount ?? 0), 16, true) + '\n';
  receipt += pad('TOTAL', 24) + pad(money(totalAmount), 16, true) + '\n';

  if (String(receiptData.paymentMethod || '').toUpperCase() === 'CASH') {
    receipt += pad('CASH', 24) + pad(money(amountPaid), 16, true) + '\n';
    receipt += pad('CHANGE', 24) + pad(money(change), 16, true) + '\n';
  }

  receipt += divider('-') + '\n';
  receipt += pad('VATABLE SALES', 24) + pad(money(receiptData.vatableSales || 0), 16, true) + '\n';
  receipt += pad('VAT EXEMPT', 24) + pad(money(receiptData.vatExemptSales || 0), 16, true) + '\n';
  receipt += pad('ZERO-RATED', 24) + pad(money(receiptData.zeroRatedSales || 0), 16, true) + '\n';
  receipt += divider('=') + '\n';
  receipt += center('Thank you for your purchase!') + '\n';

  printWindowHelper(receipt, pageWidth);
};


export const printReconciliationReport = (reportData = {}, printerWidth = '80mm') => {
  const pageWidth = printerWidth === '80mm' ? '80mm' : '58mm';
  const charsPerLine = printerWidth === '80mm' ? 42 : 32;
  const denominations = reportData.denominations || {};
  const denominationRows = [
    { label: '₱1,000', count: Number(denominations.p1000 || 0), value: 1000 },
    { label: '₱500', count: Number(denominations.p500 || 0), value: 500 },
    { label: '₱200', count: Number(denominations.p200 || 0), value: 200 },
    { label: '₱100', count: Number(denominations.p100 || 0), value: 100 },
    { label: '₱50', count: Number(denominations.p50 || 0), value: 50 },
    { label: '₱20', count: Number(denominations.p20 || 0), value: 20 },
    { label: '₱10', count: Number(denominations.p10 || 0), value: 10 },
    { label: '₱5', count: Number(denominations.p5 || 0), value: 5 },
    { label: '₱1', count: Number(denominations.p1 || 0), value: 1 },
    { label: '₱0.25', count: Number(denominations.c25 || 0), value: 0.25 },
  ];

  const pad = (value, length, right = false) => {
    const text = String(value ?? '');
    return right ? text.padStart(length, ' ') : text.padEnd(length, ' ');
  };
  const center = (value) => {
    const text = String(value ?? '');
    return ' '.repeat(Math.max(0, Math.floor((charsPerLine - text.length) / 2))) + text;
  };
  const divider = (character = '-') => character.repeat(charsPerLine);
  const money = (value) => `₱${(Number(value) || 0).toFixed(2)}`;

  const grossSales = Number(reportData.grossSales ?? reportData.expectedSales ?? 0);
  const totalDiscount = Number(reportData.totalDiscount ?? 0);
  const netSales = Number(reportData.netSales ?? grossSales);
  const posCash = Number(reportData.posCash ?? netSales);
  const cashierCash = Number(reportData.cashierCash ?? 0);
  const shortOver = Number(reportData.shortOver ?? cashierCash - posCash);

  let reconciliation = '';
  const reportDate = new Date(reportData.createdAt || Date.now());
  reconciliation += `Date: ${reportDate.toLocaleDateString()}\n`;
  reconciliation += `TRANS NO.: ${reportData.reportNo || reportData.transactionNo || 'N/A'}\n\n`;
  reconciliation += center('X-READING REPORT') + '\n';
  reconciliation += divider('_') + '\n';
  reconciliation += `Cashier: ${reportData.cashier?.username || reportData.cashierName || 'N/A'}\n`;
  reconciliation += divider('_') + '\n';
  reconciliation += pad('GROSS SALES', 20) + pad(money(grossSales), 18, true) + '\n';
  reconciliation += pad('POINTS AVAILED', 20) + pad(money(reportData.pointsAvailed || 0), 18, true) + '\n';
  reconciliation += pad('TOTAL DISCOUNT', 20) + pad(money(totalDiscount), 18, true) + '\n';
  reconciliation += divider('_') + '\n';
  reconciliation += pad('NET', 20) + pad(money(netSales), 18, true) + '\n';
  reconciliation += divider('_') + '\n';
  reconciliation += pad('CASH', 20) + pad(money(posCash), 18, true) + '\n';
  reconciliation += divider('_') + '\n';
  reconciliation += center('CASHIER ACCOUNTABILITY') + '\n';
  reconciliation += divider('_') + '\n';

  denominationRows.forEach((denomination) => {
      reconciliation += pad(`${denomination.count}  ${denomination.label}`, 22) + pad(money(denomination.count * denomination.value), 16, true) + '\n';
  });

  reconciliation += divider('_') + '\n';
  reconciliation += pad('TOTAL CASH', 20) + pad(money(cashierCash), 18, true) + '\n';
  reconciliation += pad('POS CASH', 20) + pad(money(posCash), 18, true) + '\n';
  reconciliation += pad('CASH DISCOUNT', 20) + pad(money(reportData.cashDiscount || 0), 18, true) + '\n';
  reconciliation += pad('SHORT/OVER', 20) + pad(money(shortOver), 18, true) + '\n';
  reconciliation += divider('_') + '\n';
  reconciliation += center('*** END OF REPORT ***') + '\n';

  printWindowHelper(reconciliation, pageWidth);
};

const printWindowHelper = (content, pageWidth) => {
  const printWindow = window.open('', '', 'width=400,height=700');
  if (!printWindow) {
    throw new Error('Unable to open the print window. Allow pop-ups for this POS.');
  }

  const safeContent = String(content)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  printWindow.document.write(`
    <html>
      <head>
        <title>Thermal Receipt</title>
        <style>
          @page { size: ${pageWidth} auto; margin: 0; }
          body {
            font-family: 'Courier New', monospace;
            font-size: 11px;
            margin: 0;
            padding: 10px;
            width: ${pageWidth};
            line-height: 1.35;
          }
          pre { margin: 0; white-space: pre; }
        </style>
      </head>
      <body><pre>${safeContent}</pre></body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  printWindow.onafterprint = () => printWindow.close();
};
