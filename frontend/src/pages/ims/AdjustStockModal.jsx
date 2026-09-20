import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, SlidersHorizontal, Loader2 } from 'lucide-react';
import { apiFetch } from '../../auth/apiFetch';

const API_BASE_URL = 'http://localhost:5000/api';
const FALLBACK_REASONS = ['Damaged', 'Expired', 'Lost / Theft', 'Count correction', 'Other'];

const fieldClass =
  'w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-medium text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all';

// Mount this only while a product is selected. Corrections are entered as the physically counted
// quantity; the server works out the difference against live stock and logs it.
export default function AdjustStockModal({ product, onClose, onAdjusted }) {
  const [counted, setCounted] = useState(String(product.stock));
  const [reasons, setReasons] = useState(FALLBACK_REASONS);
  const [reason, setReason] = useState(FALLBACK_REASONS[0]);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`${API_BASE_URL}/stock-adjustment-reasons`)
      .then((res) => (res.ok ? res.json() : null))
      .then((list) => {
        if (!cancelled && Array.isArray(list) && list.length) setReasons(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const countedNum = counted === '' ? null : Number(counted);
  const delta = countedNum === null || Number.isNaN(countedNum) ? null : countedNum - product.stock;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (delta === null || !Number.isInteger(countedNum) || countedNum < 0) {
      setError('Enter the counted quantity as a whole number of zero or more.');
      return;
    }
    if (delta === 0) {
      setError('The counted quantity matches the current stock — nothing to adjust.');
      return;
    }
    if (reason === 'Other' && !notes.trim()) {
      setError('Please describe the reason.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/products/${product.id}/adjust-stock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ countedQuantity: countedNum, reason, notes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to adjust stock');
      }
      onAdjusted(await res.json());
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-modal-backdrop">
      <form
        onSubmit={handleSubmit}
        className="font-sans bg-white rounded-2xl shadow-2xl shadow-slate-900/20 max-w-md w-full border border-slate-200/80 flex flex-col animate-modal-card overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/30">
              <SlidersHorizontal className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-black text-slate-800 tracking-tight">Adjust Stock</h3>
              <p className="text-[11px] text-slate-500 font-semibold truncate">{product.name}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-full transition-colors cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">System stock</label>
              <input type="text" disabled value={product.stock} className={`${fieldClass} opacity-60`} />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Counted quantity</label>
              <input type="number" min="0" step="1" value={counted} onChange={(e) => setCounted(e.target.value)} className={fieldClass} autoFocus />
            </div>
          </div>

          {delta !== null && delta !== 0 && (
            <p className={`text-xs font-bold ${delta > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              This will {delta > 0 ? 'add' : 'remove'} {Math.abs(delta)} unit{Math.abs(delta) === 1 ? '' : 's'}.
            </p>
          )}

          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Reason</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass}>
              {reasons.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              Notes {reason === 'Other' ? '(required)' : '(optional)'}
            </label>
            <input type="text" maxLength={255} value={notes} onChange={(e) => setNotes(e.target.value)} className={fieldClass} placeholder="e.g., Water damage on shelf 3" />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 transition cursor-pointer">
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center gap-2 px-5 py-2 bg-gradient-to-tr from-amber-500 to-orange-500 text-white font-bold text-xs rounded-xl shadow-md transition disabled:opacity-50 cursor-pointer"
          >
            {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {isSubmitting ? 'Saving...' : 'Apply Adjustment'}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}
