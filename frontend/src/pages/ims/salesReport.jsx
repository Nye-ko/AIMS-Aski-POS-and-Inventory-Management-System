import { useCallback, useEffect, useState } from 'react';
import { Receipt, Download, Loader2, RefreshCw, Inbox, DollarSign, Wallet, Percent, Ban } from 'lucide-react';
import { apiFetch } from '../../auth/apiFetch';
import { exportToExcel } from '../../utils/exportExcel';
import MonthPicker from '../../components/MonthPicker';

const API_BASE_URL = 'http://localhost:5000/api';
const peso = (n) => {
  const v = Number(n);
  return `${v < 0 ? '-' : ''}₱${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const PAYMENT_LABELS = { CASH: 'Cash', CARD: 'Card', E_wallet: 'E-wallet' };

const PAYMENT_STYLES = {
  CASH: { chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100', dot: 'bg-emerald-500' },
  CARD: { chip: 'bg-blue-50 text-blue-700 ring-1 ring-blue-100', dot: 'bg-blue-500' },
  E_wallet: { chip: 'bg-violet-50 text-violet-700 ring-1 ring-violet-100', dot: 'bg-violet-500' },
};

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
  const [totals, setTotals] = useState({ count: 0, subtotal: 0, discountAmount: 0, voidCount: 0, voidAmount: 0, totalAmount: 0 });
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
        'Type': r.kind === 'VOID' ? 'Void' : 'Sale',
        'Transaction #': r.transactionNo,
        'Void Of / Voided By': r.kind === 'VOID' ? r.voidOf : r.voidNo || '',
        'Items': r.itemsCount,
        'Subtotal (₱)': r.subtotal == null ? '' : Number(r.subtotal).toFixed(2),
        'Discount (₱)': r.discountAmount == null ? '' : Number(r.discountAmount).toFixed(2),
        'Total (₱)': Number(r.totalAmount).toFixed(2),
        'Payment Method': PAYMENT_LABELS[r.paymentMethod] || r.paymentMethod,
        'Cashier': r.cashier || '',
        'Void Reason': r.reason || '',
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
    { title: `Voids (${totals.voidCount || 0})`, value: peso(-(totals.voidAmount || 0)), icon: Ban, color: 'from-rose-500 to-red-600' },
    { title: 'Net Sales', value: peso(totals.totalAmount), icon: Wallet, color: 'from-indigo-600 to-purple-600' },
  ];

  return (
    <div className="space-y-6">
      <header className="relative z-30 mb-6 lg:mb-12 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-white via-white/90 to-blue-200/60 backdrop-blur-xl border border-white/80 rounded-3xl px-4 sm:px-8 py-3 sm:py-4 shadow-xl shadow-blue-500/10">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/30">
            <Receipt className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-blue-600">AMPC</p>
            <h2 className="text-lg sm:text-2xl font-black text-slate-800 tracking-tight">SALES REPORT</h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <MonthPicker value={month} onChange={setMonth} />
          <button
            onClick={fetchReport}
            className="p-2 sm:p-3 rounded-xl sm:rounded-2xl bg-white border border-slate-200/60 text-slate-700 hover:bg-slate-50 transition shadow-sm"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting || rows.length === 0}
            className="flex items-center gap-1.5 sm:gap-2 px-3 py-2 sm:px-4 sm:py-3 bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-xs sm:text-sm rounded-xl sm:rounded-2xl shadow-md shadow-blue-500/30 hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
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

      <section className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2 sm:gap-4 lg:gap-6">
        {cards.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.title}
              className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-white/80 via-blue-100/30 to-indigo-300/40 backdrop-blur-xl border border-white/80 p-3 sm:p-6 shadow-xl shadow-blue-500/10 last:col-span-2 lg:last:col-span-1"
            >
              <div className="flex items-center justify-between gap-1.5 mb-2 sm:mb-3">
                <span className="text-[9px] sm:text-xs leading-tight font-bold text-slate-600 uppercase tracking-wider">{item.title}</span>
                <div className={`p-1.5 sm:p-2.5 rounded-xl sm:rounded-2xl bg-gradient-to-tr ${item.color} text-white shadow-md shadow-blue-500/30`}>
                  <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
              </div>
              <h3 className="text-lg sm:text-2xl font-black text-slate-800 tracking-tight">{item.value}</h3>
            </div>
          );
        })}
      </section>

      <div className="bg-white border border-slate-200/80 rounded-3xl overflow-hidden shadow-xl shadow-blue-500/5">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4 border-b border-slate-100">
          <div>
            <h3 className="text-xs sm:text-sm font-extrabold text-slate-800">{monthLabel(month)}</h3>
            <p className="text-[11px] text-slate-400 font-medium">One row per sale, plus one per void (on the day it was voided)</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 border border-slate-200 px-3 py-1 text-[11px] font-bold text-slate-600">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            {rows.length.toLocaleString()} {rows.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>
        <div className="overflow-auto max-h-[700px]">
          <table className="w-full min-w-[720px] sm:min-w-[860px] text-left text-[11px] sm:text-xs">
            <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur text-slate-500 font-extrabold uppercase text-[10px] tracking-widest shadow-[0_1px_0_0_rgb(226,232,240)]">
              <tr>
                <th className="px-3 py-2 sm:px-5 sm:py-3.5">Date</th>
                <th className="px-2.5 py-2 sm:px-4 sm:py-3.5">Transaction #</th>
                <th className="px-2.5 py-2 sm:px-4 sm:py-3.5 text-center">Items</th>
                <th className="px-2.5 py-2 sm:px-4 sm:py-3.5 text-right">Subtotal</th>
                <th className="px-2.5 py-2 sm:px-4 sm:py-3.5 text-right">Discount</th>
                <th className="px-2.5 py-2 sm:px-4 sm:py-3.5 text-right">Total</th>
                <th className="px-2.5 py-2 sm:px-4 sm:py-3.5">Payment</th>
                <th className="px-3 py-2 sm:px-5 sm:py-3.5">Cashier</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!isLoading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan="8" className="px-4 py-14 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center">
                        <Inbox className="w-6 h-6" />
                      </div>
                      <span className="font-medium">No sales recorded for {monthLabel(month)}.</span>
                    </div>
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const isVoid = r.kind === 'VOID';
                const when = new Date(r.createdAt);
                const pay = PAYMENT_STYLES[r.paymentMethod] || PAYMENT_STYLES.CASH;
                return (
                  <tr
                    key={r.id}
                    title={isVoid && r.reason ? `Reason: ${r.reason}` : undefined}
                    className={`group transition-colors ${isVoid ? 'bg-rose-50/40 hover:bg-rose-50/80' : 'hover:bg-blue-50/40'}`}
                  >
                    <td className="relative px-3 py-2 sm:px-5 sm:py-3.5 whitespace-nowrap">
                      <span className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full transition-opacity ${isVoid ? 'bg-rose-400 opacity-100' : 'bg-blue-500 opacity-0 group-hover:opacity-100'}`} />
                      <div className="font-bold text-slate-700">{when.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                      <div className="text-[11px] text-slate-400 font-medium">{when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</div>
                    </td>
                    <td className="px-2.5 py-2 sm:px-4 sm:py-3.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`font-mono text-[11px] font-semibold px-2 py-1 rounded-md ${isVoid ? 'bg-rose-100/70 text-rose-700' : 'bg-slate-100 text-slate-700'}`}>{r.transactionNo}</span>
                        {isVoid && (
                          <span className="text-[10px] font-bold text-rose-600">VOID of {r.voidOf}</span>
                        )}
                        {!isVoid && r.voidNo && (
                          <span className="px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-600 text-[10px] font-bold tracking-wide" title={`Voided by ${r.voidNo}`}>
                            VOIDED
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2.5 py-2 sm:px-4 sm:py-3.5 text-center">
                      <span className="inline-flex min-w-[26px] justify-center rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-extrabold text-slate-700 tabular-nums">{r.itemsCount}</span>
                    </td>
                    <td className="px-2.5 py-2 sm:px-4 sm:py-3.5 text-right tabular-nums text-slate-600">{isVoid ? <span className="text-slate-300">—</span> : peso(r.subtotal)}</td>
                    <td className="px-2.5 py-2 sm:px-4 sm:py-3.5 text-right tabular-nums">
                      {!isVoid && Number(r.discountAmount) > 0
                        ? <span className="font-semibold text-rose-600">-{peso(r.discountAmount)}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className={`px-2.5 py-2 sm:px-4 sm:py-3.5 text-right tabular-nums text-xs sm:text-[13px] font-extrabold ${isVoid ? 'text-rose-600' : 'text-slate-900'}`}>{peso(r.totalAmount)}</td>
                    <td className="px-2.5 py-2 sm:px-4 sm:py-3.5">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${pay.chip}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${pay.dot}`} />
                        {PAYMENT_LABELS[r.paymentMethod] || r.paymentMethod}
                      </span>
                    </td>
                    <td className="px-3 py-2 sm:px-5 sm:py-3.5">
                      <span className="inline-flex items-center gap-2 text-slate-600 font-medium">
                        <span className="w-6 h-6 rounded-full bg-gradient-to-tr from-slate-700 to-slate-500 text-white text-[10px] font-bold flex items-center justify-center uppercase">
                          {(r.cashier || '?')[0]}
                        </span>
                        {r.cashier || '—'}
                      </span>
                    </td>
                  </tr>
                );
              })}
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
