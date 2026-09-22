import ExcelJS from 'exceljs';

const STATUS_STYLES = {
  'In Stock':     { fill: 'FFDCFCE7', font: 'FF15803D' },
  'Low Stock':    { fill: 'FFFEF3C7', font: 'FFB45309' },
  'Out of Stock': { fill: 'FFFEE2E2', font: 'FFB91C1C' },
  'Expired':      { fill: 'FFF3E8FF', font: 'FF7E22CE' },
};

// `sheets` ([{ name, rows }]) writes one worksheet per entry; without it `data` becomes a single "Report" sheet.
// Shared by every page that exports a table to .xlsx (inventory, sales ledger, sales report, purchasing docs).
export const exportToExcel = async (data, fileName, sheets = null) => {
  const sheetList = (sheets || [{ name: 'Report', rows: data }]).filter((sheet) => sheet.rows && sheet.rows.length > 0);
  if (sheetList.length === 0) {
    alert("No data available to export.");
    return;
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'AMPC Inventory';
  wb.created = new Date();

  const addSheet = (name, data) => {
    const headers = Object.keys(data[0]);
    const moneyHeaders = new Set(headers.filter((h) => h.includes('₱')));
    const statusColIndex = headers.indexOf('Status') + 1;

    const ws = wb.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    ws.columns = headers.map((h) => {
      const maxLen = data.reduce((max, row) => {
        const val = row[h];
        return Math.max(max, val == null ? 0 : String(val).length);
      }, h.length);
      return { header: h, key: h, width: Math.min(Math.max(maxLen + 3, 12), 40) };
    });

    data.forEach((row) => {
      const values = {};
      headers.forEach((h) => {
        const raw = row[h];
        values[h] = moneyHeaders.has(h) && raw !== '' && raw != null ? Number(raw) : raw;
      });
      ws.addRow(values);
    });

    const thinBorder = (color) => ({
      top: { style: 'thin', color: { argb: color } },
      bottom: { style: 'thin', color: { argb: color } },
      left: { style: 'thin', color: { argb: color } },
      right: { style: 'thin', color: { argb: color } },
    });

    const headerRow = ws.getRow(1);
    headerRow.height = 20;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = thinBorder('FFCBD5E1');
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

    for (let i = 2; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      const isEven = i % 2 === 0;
      row.eachCell((cell, colNumber) => {
        const header = headers[colNumber - 1];
        cell.border = thinBorder('FFE2E8F0');
        if (moneyHeaders.has(header)) {
          cell.numFmt = '#,##0.00';
          cell.alignment = { horizontal: 'right' };
        } else if (typeof cell.value === 'number') {
          cell.alignment = { horizontal: 'center' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        }
        if (isEven) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        }
      });

      if (statusColIndex > 0) {
        const statusCell = row.getCell(statusColIndex);
        const style = STATUS_STYLES[statusCell.value];
        if (style) {
          statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.fill } };
          statusCell.font = { bold: true, color: { argb: style.font } };
          statusCell.alignment = { horizontal: 'center' };
        }
      }
    }
  };
  sheetList.forEach((sheet) => addSheet(sheet.name, sheet.rows));

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileName}_${Date.now()}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
