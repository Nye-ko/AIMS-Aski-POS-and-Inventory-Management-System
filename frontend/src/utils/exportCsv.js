/**
 * Exports single or multiple X-Reading Reconciliation Reports to styled Excel (.xls) format
 * @param {Object|Array} dataOverride
 */
export const exportCsv = (dataOverride = null) => {
  // Default structure matching updated Prisma Schema
  const defaultData = {
    reportNo: `00${Math.floor(1000 + Math.random() * 9000)}`,
    createdAt: new Date().toISOString(),
    cashier: { username: 'RACHELLE' },
    
    // Sales Totals
    grossSales: 5438.82,
    pointsAvailed: 0.00,
    totalDiscount: 0.20,
    netSales: 5438.62,
    
    // Cash Accountability Denominations
    p1000: 0, p500: 0, p200: 0, p100: 0, p50: 0, 
    p20: 0, p10: 0, p5: 0, p1: 5701,
    p0_50: 0, c25: 0, p0_10: 0, p0_05: 0, p0_01: 0,

    // Audit Totals
    posCash: 5438.62,
    cashDiscount: 0.00,
    cashierCash: 5701.00,
    shortOver: -262.38,
  };

  const records = Array.isArray(dataOverride) 
    ? dataOverride 
    : [dataOverride || defaultData];

  const formatMoney = (val) => Number(val || 0).toFixed(2);

  // Generate Excel-compatible XML HTML String
  const htmlContent = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta http-equiv="content-type" content="text/vnd.ms-excel; charset=UTF-8">
      <style>
        body { font-family: 'Courier New', Courier, monospace; font-size: 13px; color: #000; }
        .receipt-card { width: 380px; margin-bottom: 40px; border: 1px solid #ccc; padding: 15px; background: #fff; }
        .header-title { font-size: 16px; font-weight: bold; text-align: center; margin-bottom: 5px; }
        .center-text { text-align: center; }
        .divider { border-top: 2px dashed #000; margin: 8px 0; }
        .solid-divider { border-top: 2px solid #000; margin: 8px 0; }
        
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        td { padding: 3px 0; vertical-align: middle; }
        
        .label { font-weight: bold; text-align: left; }
        .val { text-align: right; font-family: monospace; }
        .qty { text-align: left; width: 50px; }
        .denom { text-align: center; }
        
        .shortage { color: #dc2626; font-weight: bold; }
        .overage { color: #059669; font-weight: bold; }
        .balanced { color: #1e293b; font-weight: bold; }
      </style>
    </head>
    <body>
      ${records.map(r => {
        const itemDate = new Date(r.createdAt || Date.now());
        const dateStr = itemDate.toLocaleDateString('en-PH', { month: '2-digit', day: '2-digit', year: 'numeric' });
        const cashierName = r.cashier?.username || r.cashierName || 'RACHELLE';
        
        const shortOverVal = parseFloat(r.shortOver ?? 0);
        const shortOverClass = shortOverVal < 0 ? 'shortage' : shortOverVal > 0 ? 'overage' : 'balanced';

        // Denomination mapping list directly aligned with receipt layout
        const denoms = [
          { qty: r.p1000, val: 1000.00, label: 'P 1,000.00' },
          { qty: r.p500,  val: 500.00,  label: 'P   500.00' },
          { qty: r.p200,  val: 200.00,  label: 'P   200.00' },
          { qty: r.p100,  val: 100.00,  label: 'P   100.00' },
          { qty: r.p50,   val: 50.00,   label: 'P    50.00' },
          { qty: r.p20,   val: 20.00,   label: 'P    20.00' },
          { qty: r.p10,   val: 10.00,   label: 'P    10.00' },
          { qty: r.p5,    val: 5.00,    label: 'P     5.00' },
          { qty: r.p1,    val: 1.00,    label: 'P     1.00' },
          { qty: r.p0_50, val: 0.50,    label: 'P     0.50' },
          { qty: r.c25 ?? r.p0_25, val: 0.25, label: 'P     0.25' },
          { qty: r.p0_10, val: 0.10,    label: 'P     0.10' },
          { qty: r.p0_05, val: 0.05,    label: 'P     0.05' },
          { qty: r.p0_01, val: 0.01,    label: 'P     0.01' },
        ];

        return `
          <div class="receipt-card">
            <table>
              <tr><td colspan="2">${dateStr}</td></tr>
              <tr><td colspan="2">TRANS NO : #${r.reportNo || '000000'}</td></tr>
            </table>

            <div class="header-title">X-READING REPORT</div>
            <div class="solid-divider"></div>

            <table>
              <tr>
                <td class="label">Cashier :</td>
                <td style="text-align: left;">${cashierName}</td>
              </tr>
            </table>

            <div class="solid-divider"></div>

            <table>
              <tr>
                <td class="label">GROSS</td>
                <td class="val">${formatMoney(r.grossSales)}</td>
              </tr>
              <tr>
                <td class="label">POINTS AVAILED</td>
                <td class="val">${formatMoney(r.pointsAvailed)}</td>
              </tr>
              <tr>
                <td class="label">TOTAL DISCOUNT</td>
                <td class="val">${formatMoney(r.totalDiscount)}</td>
              </tr>
            </table>

            <div class="solid-divider"></div>

            <table>
              <tr>
                <td class="label">NET</td>
                <td class="val">${formatMoney(r.netSales)}</td>
              </tr>
            </table>

            <div class="solid-divider"></div>

            <table>
              <tr>
                <td class="label">CASH</td>
                <td class="val">${formatMoney(r.netSales)}</td>
              </tr>
            </table>

            <div class="solid-divider"></div>
            <div class="header-title" style="font-size: 13px;">CASHIER ACCOUNTABILITY</div>
            <div class="solid-divider"></div>

            <table>
              ${denoms.map(d => {
                const count = parseInt(d.qty || 0, 10);
                const lineTotal = count * d.val;
                return `
                  <tr>
                    <td class="qty">${count}</td>
                    <td class="denom">${d.label}</td>
                    <td class="val">${formatMoney(lineTotal)}</td>
                  </tr>
                `;
              }).join('')}
            </table>

            <div class="solid-divider"></div>

            <table>
              <tr>
                <td class="label">TOTAL CASH</td>
                <td class="val">${formatMoney(r.cashierCash)}</td>
              </tr>
            </table>

            <div class="solid-divider"></div>

            <table>
              <tr>
                <td class="label">POS CASH</td>
                <td class="val">${formatMoney(r.posCash)}</td>
              </tr>
              <tr>
                <td class="label">CASH DISC :</td>
                <td class="val">${formatMoney(r.cashDiscount)}</td>
              </tr>
              <tr>
                <td class="label">CASHIER CASH</td>
                <td class="val">${formatMoney(r.cashierCash)}</td>
              </tr>
              <tr>
                <td class="label">SHORT/OVER</td>
                <td class="val ${shortOverClass}">${formatMoney(shortOverVal)}</td>
              </tr>
            </table>

            <div class="solid-divider"></div>
            <div class="center-text" style="margin-top: 10px; font-weight: bold;">***END OF REPORT***</div>
          </div>
        `;
      }).join('')}
    </body>
    </html>
  `;

  // Trigger Excel File Download
  const blob = new Blob([htmlContent], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  const fileNameDate = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `X_Reading_Report_${fileNameDate}.xls`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};