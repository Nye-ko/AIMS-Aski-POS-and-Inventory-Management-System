import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, History, Loader2, Inbox } from 'lucide-react';
import { apiFetch } from '../../auth/apiFetch';

const API_BASE_URL = 'http://localhost:5000/api';
const PAGE_SIZE = 50;

const TYPE_LABELS = {
  OPENING: 'Opening balance',
  PURCHASE_RECEIPT: 'Received',
  MANUAL_ADD: 'Stock added',
  SALE: 'Sale',
  PURCHASE_RETURN: 'Returned to supplier',
  ADJUSTMENT: 'Adjustment',
};

// Mount this only while a product is selected; it loads that product's ledger on mount.
export default function StockHistoryModal({ product, onClose }) {
  const [movements, setMovements] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);

  const applyPage = (rows, before) => {
    setMovements((prev) => (before ? [...prev, ...rows] : rows));
    setHasMore(rows.length === PAGE_SIZE);
  };

  const fetchPage = useCallback(
    async (before) => {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (before) query.set('before', String(before));
      const res = await apiFetch(`${API_BASE_URL}/products/${product.id}/movements?${query}`);
      if (!res.ok) throw new Error('Failed to load stock history');
      return res.json();
    },
    [product.id]
  );

  useEffect(() => {
    let cancelled = false;
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
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-full transition-colors cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <div className="mb-3 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">{error}</div>
          )}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-extrabold uppercase text-[10px] tracking-wider border-b-2 border-slate-200">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-center">Change</th>
                  <th className="px-4 py-3 text-center">Balance</th>
                  <th className="px-4 py-3">Reference / Reason</th>
                  <th className="px-4 py-3">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!isLoading && !error && movements.length === 0 && (
                  <tr>
                    <td colSpan="6" className="px-4 py-10 text-center text-slate-400">
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
                    <td className="px-4 py-3 text-slate-500">
                      {m.referenceNo && <span className="font-mono text-slate-700">{m.referenceNo}</span>}
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
        </div>
      </div>
    </div>,
    document.body
  );
}
