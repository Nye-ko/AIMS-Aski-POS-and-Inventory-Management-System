import { useCallback, useEffect, useState } from 'react';
import { Receipt, Download, Loader2, RefreshCw, Inbox, DollarSign, Wallet, Percent } from 'lucide-react';
import { apiFetch } from '../../auth/apiFetch';
import { exportToExcel } from '../../utils/exportExcel';

const API_BASE_URL = 'http://localhost:5000/api';
const peso = (n) => `₱${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PAYMENT_LABELS = { CASH: 'Cash', CARD: 'Card', E_wallet: 'E-wallet' };

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const monthLabel = (month) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

export default function SalesReport() {
  const [month, setMonth] = useState(currentMonth());
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({ count: 0, subtotal: 0, discountAmount: 0, totalAmount: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isExporting, setIsExporting] = useState(false);

  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE_URL}/sales-report?month=${month}`);
      if (!res.ok) throw new Error('Failed to load sales report');
      const data = await res.json();
      setRows(data.rows);
      setTotals(data.totals);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [month]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const sheetRows = rows.map((r) => ({
        'Date': new Date(r.createdAt).toLocaleString(),
        'Transaction #': r.transactionNo,
        'Items': r.itemsCount,
        'Subtotal (₱)': Number(r.subtotal).toFixed(2),
        'Discount (₱)': Number(r.discountAmount).toFixed(2),
        'Total (₱)': Number(r.totalAmount).toFixed(2),
        'Payment Method': PAYMENT_LABELS[r.paymentMethod] || r.paymentMethod,
        'Cashier': r.cashier || '',
      }));
      await exportToExcel(sheetRows, `Sales_Report_${month}`);
    } finally {
      setIsExporting(false);
    }
  };

  const cards = [
    { title: 'Transactions', value: totals.count.toLocaleString(), icon: Receipt, color: 'from-blue-600 to-indigo-600' },
    { title: 'Gross Sales', value: peso(totals.subtotal), icon: DollarSign, color: 'from-emerald-600 to-teal-600' },
    { title: 'Discounts', value: peso(totals.discountAmount), icon: Percent, color: 'from-amber-500 to-orange-600' },
    { title: 'Net Sales', value: peso(totals.totalAmount), icon: Wallet, color: 'from-indigo-600 to-purple-600' },
  ];

  return (
    <div className="space-y-6">
      <header className="relative z-30 flex items-center justify-between bg-gradient-to-r from-white via-white/90 to-blue-200/60 backdrop-blur-xl border border-white/80 rounded-3xl px-8 py-4 shadow-xl shadow-blue-500/10">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/30">
            <Receipt className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-blue-600">AMPC POS</p>
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">SALES REPORT</h2>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="px-3.5 py-2.5 bg-white border border-slate-200/80 rounded-xl text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-400"
          />
          <button
            onClick={fetchReport}
            className="p-3 rounded-2xl bg-white border border-slate-200/60 text-slate-700 hover:bg-slate-50 transition shadow-sm"
            title="Refresh"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting || rows.length === 0}
            className="flex items-center gap-2 px-4 py-3 bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-sm rounded-2xl shadow-md shadow-blue-500/30 hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export
          </button>
        </div>
      </header>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 text-sm font-semibold flex items-center justify-between">
          <span>{error}</span>
          <button onClick={fetchReport} className="underline">Retry</button>
        </div>
      )}

      <section className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {cards.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.title}
              className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-white/80 via-blue-100/30 to-indigo-300/40 backdrop-blur-xl border border-white/80 p-6 shadow-xl shadow-blue-500/10"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">{item.title}</span>
                <div className={`p-2.5 rounded-2xl bg-gradient-to-tr ${item.color} text-white shadow-md shadow-blue-500/30`}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
              <h3 className="text-2xl font-black text-slate-800 tracking-tight">{item.value}</h3>
            </div>
          );
        })}
      </section>

      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xl shadow-blue-500/5">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-800">{monthLabel(month)} — one row per transaction</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-extrabold uppercase text-[10px] tracking-wider border-b-2 border-slate-200">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Transaction #</th>
                <th className="px-4 py-3 text-center">Items</th>
                <th className="px-4 py-3 text-right">Subtotal</th>
                <th className="px-4 py-3 text-right">Discount</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Cashier</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!isLoading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan="8" className="px-4 py-10 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <Inbox className="w-6 h-6" />
                      <span>No sales recorded for {monthLabel(month)}.</span>
                    </div>
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 font-mono text-slate-700">{r.transactionNo}</td>
                  <td className="px-4 py-3 text-center font-bold text-slate-900">{r.itemsCount}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{peso(r.subtotal)}</td>
                  <td className="px-4 py-3 text-right text-rose-600">{Number(r.discountAmount) > 0 ? `-${peso(r.discountAmount)}` : '—'}</td>
                  <td className="px-4 py-3 text-right font-bold text-slate-900">{peso(r.totalAmount)}</td>
                  <td className="px-4 py-3 text-slate-500">{PAYMENT_LABELS[r.paymentMethod] || r.paymentMethod}</td>
                  <td className="px-4 py-3 text-slate-500">{r.cashier || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-6 text-slate-400 text-xs">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading report...
          </div>
        )}
      </div>
    </div>
  );
}
