import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, History, Loader2, Inbox, Download, Layers } from 'lucide-react';
import { apiFetch } from '../../auth/apiFetch';

const API_BASE_URL = 'http://localhost:5000/api';
const PAGE_SIZE = 50;
const peso = (n) => `₱${Number(n).toFixed(2)}`;

const TYPE_LABELS = {
  OPENING: 'Opening balance',
  PURCHASE_RECEIPT: 'Received',
  MANUAL_ADD: 'Stock added',
  SALE: 'Sale',
  PURCHASE_RETURN: 'Returned to supplier',
  ADJUSTMENT: 'Adjustment',
};

// Mirrors StockBatch.referenceType on the backend.
const BATCH_SOURCE_LABELS = {
  Opening: 'Opening balance',
  ReceivingReport: 'Received',
  ManualAdd: 'Stock added',
  Adjustment: 'Adjustment',
};

// Mount this only while a product is selected; it loads that product's ledger on mount.
// `exportToExcel` (from inventoryList.jsx) is optional — without it the Export button is hidden.
export default function StockHistoryModal({ product, onClose, exportToExcel }) {
  const [tab, setTab] = useState('ledger'); // 'ledger' | 'batches'

  const [movements, setMovements] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // FIFO cost batches (Phase 4) — loaded lazily the first time the Batches tab is opened.
  const [batches, setBatches] = useState([]);
  const [batchesLoaded, setBatchesLoaded] = useState(false);
  const [isBatchesLoading, setIsBatchesLoading] = useState(false);
  const [batchesError, setBatchesError] = useState(null);

  const applyPage = (rows, before) => {
    setMovements((prev) => (before ? [...prev, ...rows] : rows));
    setHasMore(rows.length === PAGE_SIZE);
  };

  const fetchPage = useCallback(
    async (before) => {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (before) query.set('before', String(before));
      if (fromDate) query.set('from', fromDate);
      if (toDate) query.set('to', toDate);
      const res = await apiFetch(`${API_BASE_URL}/products/${product.id}/movements?${query}`);
      if (!res.ok) throw new Error('Failed to load stock history');
      return res.json();
    },
    [product.id, fromDate, toDate]
  );

  // Re-runs from scratch (fresh page, no cursor) whenever the product or date range changes.
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    fetchPage()
      .then((rows) => {
        if (!cancelled) applyPage(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  // Loaded once, the first time the Batches tab is opened (batches don't page like the ledger).
  useEffect(() => {
    if (tab !== 'batches' || batchesLoaded) return;
    let cancelled = false;
    setIsBatchesLoading(true);
    setBatchesError(null);
    apiFetch(`${API_BASE_URL}/products/${product.id}/batches`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load cost batches');
        return res.json();
      })
      .then((rows) => {
        if (cancelled) return;
        setBatches(rows);
        setBatchesLoaded(true);
      })
      .catch((err) => {
        if (!cancelled) setBatchesError(err.message);
      })
      .finally(() => {
        if (!cancelled) setIsBatchesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, batchesLoaded, product.id]);

  const loadOlder = async () => {
    const before = movements[movements.length - 1].id;
    setIsLoading(true);
    setError(null);
    try {
      applyPage(await fetchPage(before), before);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetches this product's whole ledger (not just the loaded pages) and hands it to the shared exporter.
  const handleExport = async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      const query = new URLSearchParams();
      if (fromDate) query.set('from', fromDate);
      if (toDate) query.set('to', toDate);
      const res = await apiFetch(`${API_BASE_URL}/products/${product.id}/movements/export?${query}`);
      if (!res.ok) throw new Error('Failed to export sales ledger');
      const rows = (await res.json()).map((m) => ({
        'When': new Date(m.createdAt).toLocaleString(),
        'Type': TYPE_LABELS[m.type] || m.type,
        'Change': m.quantity,
        'Balance After': m.balanceAfter,
        'Amount (₱)': m.amount != null ? Number(m.amount).toFixed(2) : '',
        'Reference': m.referenceNo || '',
        'PO Number': m.poNumber || '',
        'Reason': m.reason || '',
        'By': m.user?.username || '',
      }));
      await exportToExcel(rows, `${product.sku || product.name}_Sales_Ledger`);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setIsExporting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-modal-backdrop">
      <div className="font-sans bg-white rounded-2xl shadow-2xl shadow-slate-900/20 max-w-4xl w-full border border-slate-200/80 max-h-[88vh] flex flex-col animate-modal-card overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/30">
              <History className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-black text-slate-800 tracking-tight">Stock History</h3>
              <p className="text-[11px] text-slate-500 font-semibold truncate">
                {product.name} — current stock {product.stock}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {tab === 'ledger' && (
              <>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  max={toDate || undefined}
                  className="bg-white border border-slate-200 rounded-xl px-2.5 py-2 text-xs font-medium text-slate-700 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                />
                <span className="text-slate-400 text-xs">to</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  min={fromDate || undefined}
                  className="bg-white border border-slate-200 rounded-xl px-2.5 py-2 text-xs font-medium text-slate-700 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                />
                {(fromDate || toDate) && (
                  <button
                    type="button"
                    onClick={() => { setFromDate(''); setToDate(''); }}
                    className="text-[11px] font-bold text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </>
            )}
            {tab === 'ledger' && exportToExcel && (
              <button
                type="button"
                onClick={handleExport}
                disabled={isExporting}
                className="flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200/80 text-slate-600 font-semibold text-xs rounded-xl hover:border-indigo-200 hover:bg-slate-50 hover:text-slate-900 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4 text-emerald-600" />}
                <span>Export</span>
              </button>
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-full transition-colors cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 px-6 pt-3 shrink-0">
          <button
            type="button"
            onClick={() => setTab('ledger')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors cursor-pointer ${
              tab === 'ledger' ? 'bg-blue-50 text-blue-600' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            Ledger
          </button>
          <button
            type="button"
            onClick={() => setTab('batches')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors cursor-pointer ${
              tab === 'batches' ? 'bg-blue-50 text-blue-600' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Batches
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && tab === 'ledger' && (
            <div className="mb-3 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">{error}</div>
          )}
          {exportError && tab === 'ledger' && (
            <div className="mb-3 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">{exportError}</div>
          )}
          {tab === 'ledger' && (
          <>
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-extrabold uppercase text-[10px] tracking-wider border-b-2 border-slate-200">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-center">Change</th>
                  <th className="px-4 py-3 text-center">Balance</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Reference / Reason</th>
                  <th className="px-4 py-3">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!isLoading && !error && movements.length === 0 && (
                  <tr>
                    <td colSpan="7" className="px-4 py-10 text-center text-slate-400">
                      <div className="flex flex-col items-center gap-2">
                        <Inbox className="w-6 h-6" />
                        <span>No stock movements recorded yet.</span>
                      </div>
                    </td>
                  </tr>
                )}
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{new Date(m.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3 font-semibold text-slate-700">{TYPE_LABELS[m.type] || m.type}</td>
                    <td className={`px-4 py-3 text-center font-black ${m.quantity > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-slate-900">{m.balanceAfter}</td>
                    <td className="px-4 py-3 text-right text-slate-700 font-semibold whitespace-nowrap">
                      {m.amount != null ? peso(m.amount) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {m.referenceNo && <span className="font-mono text-slate-700">{m.referenceNo}</span>}
                      {m.poNumber && <span className="text-slate-400"> ({m.poNumber})</span>}
                      {m.referenceNo && m.reason ? ' — ' : ''}
                      {m.reason}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{m.user?.username || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-6 text-slate-400 text-xs">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading history...
            </div>
          )}
          {!isLoading && hasMore && (
            <div className="flex justify-center pt-4">
              <button
                type="button"
                onClick={loadOlder}
                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 transition cursor-pointer"
              >
                Load older
              </button>
            </div>
          )}
          </>
          )}

          {tab === 'batches' && (
            <>
              {batchesError && (
                <div className="mb-3 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">{batchesError}</div>
              )}
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-extrabold uppercase text-[10px] tracking-wider border-b-2 border-slate-200">
                    <tr>
                      <th className="px-4 py-3">Received</th>
                      <th className="px-4 py-3">Source</th>
                      <th className="px-4 py-3">Supplier</th>
                      <th className="px-4 py-3 text-right">Unit Cost</th>
                      <th className="px-4 py-3 text-center">Qty Received</th>
                      <th className="px-4 py-3 text-center">Qty Remaining</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {!isBatchesLoading && !batchesError && batches.length === 0 && (
                      <tr>
                        <td colSpan="7" className="px-4 py-10 text-center text-slate-400">
                          <div className="flex flex-col items-center gap-2">
                            <Inbox className="w-6 h-6" />
                            <span>No cost batches recorded yet.</span>
                          </div>
                        </td>
                      </tr>
                    )}
                    {batches.map((b) => (
                      <tr key={b.id}>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{new Date(b.receivedAt).toLocaleString()}</td>
                        <td className="px-4 py-3 font-semibold text-slate-700 whitespace-nowrap">
                          {BATCH_SOURCE_LABELS[b.referenceType] || b.referenceType || '—'}
                          {b.referenceNo ? <span className="text-slate-400 font-normal"> ({b.referenceNo})</span> : null}
                        </td>
                        <td className="px-4 py-3 text-slate-500">{b.supplier?.name || '—'}</td>
                        <td className="px-4 py-3 text-right text-slate-700 font-semibold whitespace-nowrap">{peso(b.unitCost)}</td>
                        <td className="px-4 py-3 text-center font-bold text-slate-900">{b.qtyReceived}</td>
                        <td className={`px-4 py-3 text-center font-black ${b.qtyRemaining > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>
                          {b.qtyRemaining}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            b.qtyRemaining > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'
                          }`}>
                            {b.qtyRemaining > 0 ? 'Active' : 'Exhausted'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {isBatchesLoading && (
                <div className="flex items-center justify-center gap-2 py-6 text-slate-400 text-xs">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading batches...
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
