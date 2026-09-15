/**
 * Prints receipt to a thermal printer through the browser print dialog.
 * @param {Object} receiptData - Transaction data
 * @param {string} printerWidth - '80mm' or '58mm'
 */
export const printThermalReceipt = (receiptData, printerWidth = '80mm') => {
  const pageWidth = printerWidth === '80mm' ? '80mm' : '58mm';
  const charsPerLine = printerWidth === '80mm' ? 42 : 32;
  const items = Array.isArray(receiptData.items) ? receiptData.items : [];
  const totalAmount = Number(receiptData.totalAmount) || 0;
  const amountPaid = Number(receiptData.amountPaid) || 0;
  const change = Math.max(0, amountPaid - totalAmount);

  const pad = (value, length, right = false) => {
    const text = String(value);
    return right ? text.padStart(length) : text.padEnd(length);
  };
  const center = (value) => {
    const text = String(value);
    return ' '.repeat(Math.max(0, Math.floor((charsPerLine - text.length) / 2))) + text;
  };
  const divider = (character = '-') => character.repeat(charsPerLine);
  const money = (value) => `₱${(Number(value) || 0).toFixed(2)}`;
  const fieldLine = (label) => `${label}: ${'_'.repeat(Math.max(0, charsPerLine - label.length - 2))}`;
  const amountLine = () => pad('', 32) + pad('__________', 10, true);

  let receipt = '';
  receipt += center('ASKI MULTI-PURPOSE COOPERATIVE') + '\n\n';
  receipt += center('#135 BARANGAY ANDAL ALIA?O, TALISAY CITY, NUEVA ECIJA') + '\n';
  receipt += center('TIN: 000-000-000-000') + '\n\n';

  receipt += pad(`SI No. :`, charsPerLine) + '\n';
  receipt += `Date: ${new Date().toLocaleDateString()}\n`;
  receipt += `Time: ${new Date().toLocaleTimeString()}\n\n`;
  receipt += `${fieldLine('Name')}\n`;
  receipt += `${fieldLine('Address')}\n`;
  receipt += `${fieldLine('TIN')}\n\n`;
  receipt += divider('=') + '\n';

  items.forEach((item) => {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unitPrice) || 0;
    const itemName = String(item.name || 'Item').substring(0, 20);
    receipt += pad(itemName, 20) + pad(quantity, 5, true) + pad(money(quantity * unitPrice), 17, true) + '\n';
    receipt += pad(`@ ${money(unitPrice)}`, charsPerLine) + '\n';
  });

  receipt += `No. of Items: ${items.length}\n`;
  receipt += divider('=') + '\n';
  receipt += pad('TOTAL:', 32) + pad(money(totalAmount), 10, true) + '\n';
  if (String(receiptData.paymentMethod).toUpperCase() === 'CASH') {
    receipt += pad('CASH:', 32) + pad(money(amountPaid), 10, true) + '\n';
    receipt += pad('CHANGE:', 32) + pad(money(change), 10, true) + '\n';
  }
  receipt += divider() + '\n';
  receipt += `CASHIER: ${receiptData.cashierName || receiptData.cashier || 'N/A'}\n`;
  receipt += 'Terminal No. : 001\n';
  receipt += divider('=') + '\n';

  receipt += `Txn No. : ${receiptData.transactionId || 'N/A'}\n`;
  receipt += `Date: ${new Date().toLocaleString()}\n`;
  receipt += divider('=') + '\n';

  receipt += pad('VATable Sales (T)', 32) + pad(money(receiptData.vatableSales || 0), 10, true) + '\n';
  receipt += amountLine() + '\n';
  receipt += pad('VAT Exempt Sales (X)', 32) + pad(money(receiptData.totalSales || 0), 10, true) + '\n';
  receipt += amountLine() + '\n';
  receipt += pad('Zero-Rated Sales (Z)', 32) + pad(money(receiptData.zeroRatedSales || 0), 10, true) + '\n';
  receipt += amountLine() + '\n\n';

  receipt += pad(`Total Sale`, 32) + pad(money(totalAmount), 10, true) + '\n';
  receipt += pad(`VAT`, 32) + pad(money(receiptData.vatAmount || 0), 10, true) + '\n' + divider('-') + '\n';

  receipt += pad(`Total`, 32) + pad(money(totalAmount), 10, true) + '\n';

  receipt += divider('=') + '\n';

  receipt += center('Thank you for your purchase!') + '\n';
  receipt += center('THIS SERVES AS AN OFFICIAL RECEIPT') + '\n';
  receipt += divider('=') + '\n';

  const printWindow = window.open('', '', 'width=400,height=600');
  if (!printWindow) {
    throw new Error('Unable to open the print window. Allow pop-ups for this POS.');
  }

  printWindow.document.write(`
    <html>
      <head>
        <title>Receipt</title>
        <style>
          @page { size: ${pageWidth} auto; margin: 0; }
          body { font-family: 'Courier New', monospace; font-size: 11px; margin: 0; padding: 10px; width: ${pageWidth}; line-height: 1.4; }
          pre { margin: 0; white-space: pre; }
        </style>
      </head>
      <body><pre>${receipt}</pre></body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  printWindow.onafterprint = () => printWindow.close();
};
