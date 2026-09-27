import { useEffect, useState } from 'react';
import { X, Search, Loader2, Ban, Printer, ChevronLeft, Lock } from 'lucide-react';
import { apiFetch } from '../auth/apiFetch';

import { API_BASE_URL as API } from '../config';
const PAYMENT_LABELS = { CASH: 'Cash', CARD: 'Card', E_wallet: 'E-wallet' };
const php = (n) => `PHP ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const describePrint = (print) => {
  if (!print) return { ok: false, message: 'Print status unknown.' };
  if (print.printed) return { ok: true, message: print.reprint ? 'Void slip reprinted.' : 'Void slip printed on the receipt printer.' };
  if (print.reason === 'not_configured') {
    return { ok: false, message: 'Void slip not printed: no receipt printer is set up for this computer (RECEIPT_PRINTER_INTERFACE in backend/.env). The void is saved. Press Reprint once the printer is set up.' };
  }
  if (print.reason === 'unreachable') {
    return { ok: false, message: "Void slip not printed: the receipt printer isn't reachable. Check that it's on, connected and has paper, then press Reprint." };
  }
  return { ok: false, message: `Void slip not printed: ${print.error || 'printer error'}. Press Reprint to try again.` };
};

// Supervisor-gated void of a completed sale: pick the sale (this shift's, or search any by
// transaction number), give a reason and a supervisor PIN, and the void slip prints. `onVoided`
// runs after a successful void (the voided items are back in stock).
export default function VoidSaleModal({ onClose, onVoided }) {
  const [step, setStep] = useState('pick'); // 'pick' | 'confirm' | 'done'
  const [search, setSearch] = useState('');
  const [sales, setSales] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [isReprinting, setIsReprinting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsLoading(true);
      setListError('');
      try {
        const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
        const res = await apiFetch(`${API}/pos/sales${query}`);
        const data = await res.json().catch(() => []);
        if (!res.ok) throw new Error(data.error || 'Failed to load sales.');
        if (!cancelled) setSales(data);
      } catch (err) {
        if (!cancelled) setListError(err.message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }, search ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  const handlePick = (sale) => {
    if (!sale.voidable) return;
    setSelected(sale);
    setReason('');
    setPin('');
    setSubmitError('');
    setStep('confirm');
  };

  const handleVoid = async () => {
    if (isSubmitting) return;
    if (!reason.trim()) {
      setSubmitError('Enter the reason for voiding this sale.');
      return;
    }
    setIsSubmitting(true);
    setSubmitError('');
    try {
      const approveRes = await apiFetch(`${API}/pos/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, action: 'VOID' }),
      });
      const approval = await approveRes.json().catch(() => ({}));
      if (!approveRes.ok) throw new Error(approval.error || 'Supervisor approval failed.');

      const res = await apiFetch(`${API}/pos/voids`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Approval-Token': approval.token },
        body: JSON.stringify({ transactionId: selected.id, reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to void the sale.');

      setResult(data);
      setPin('');
      setStep('done');
      onVoided?.();
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReprint = async () => {
    if (!result || isReprinting) return;
    setIsReprinting(true);
    let print;
    try {
      const res = await apiFetch(`${API}/voids/${result.id}/reprint`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      print = res.ok ? { ...data, reprint: true } : { printed: false, reason: 'error', error: data.error || 'Reprint failed' };
    } catch (err) {
      print = { printed: false, reason: 'error', error: err.message };
    } finally {
      setIsReprinting(false);
    }
    setResult((prev) => ({ ...prev, print }));
  };

  const status = step === 'done' ? describePrint(result?.print) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg border border-slate-100 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 shrink-0">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            {step === 'confirm' && (
              <button type="button" onClick={() => setStep('pick')} className="text-slate-400 hover:text-slate-600 cursor-pointer" aria-label="Back">
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <Ban className="w-4 h-4 text-rose-600" />
            {step === 'pick' && 'Void Sale — choose the sale'}
            {step === 'confirm' && `Void ${selected?.transactionNo}`}
            {step === 'done' && `Voided — ${result?.voidNo}`}
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {step === 'pick' && (
          <div className="p-5 flex flex-col gap-3 overflow-hidden text-xs">
            <div className="relative shrink-0">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search any sale by transaction number…"
                autoFocus
                className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            <p className="text-slate-400 font-medium shrink-0">
              {search.trim() ? 'Matching sales (newest first).' : 'Your sales since your last Z-Reading (newest first).'}
            </p>
            <div className="overflow-y-auto -mx-1 px-1 space-y-2">
              {isLoading && (
                <div className="flex items-center justify-center gap-2 py-8 text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading sales…
                </div>
              )}
              {!isLoading && listError && <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 font-semibold">{listError}</div>}
              {!isLoading && !listError && sales.length === 0 && (
                <p className="py-8 text-center text-slate-400 font-medium">{search.trim() ? 'No sale matches that number.' : 'No sales in your current shift.'}</p>
              )}
              {!isLoading &&
                sales.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    disabled={!s.voidable}
                    onClick={() => handlePick(s)}
                    className={`w-full text-left rounded-xl border p-3 transition-colors ${s.voidable ? 'border-slate-200 hover:border-rose-300 hover:bg-rose-50/40 cursor-pointer' : 'border-slate-100 bg-slate-50 opacity-60 cursor-not-allowed'}`}
                  >
                    <div className="flex justify-between gap-3">
                      <span className="font-mono font-bold text-slate-800">{s.transactionNo}</span>
                      <span className="font-bold text-slate-900 whitespace-nowrap">{php(s.totalAmount)}</span>
                    </div>
                    <div className="flex justify-between gap-3 mt-1 text-slate-500 font-medium">
                      <span>
                        {new Date(s.createdAt).toLocaleString()} · {s.cashier} · {PAYMENT_LABELS[s.paymentMethod] || s.paymentMethod}
                      </span>
                      <span className="whitespace-nowrap">{s.items.length} item(s)</span>
                    </div>
                    {s.notVoidableReason && <p className="mt-1 text-rose-600 font-bold">{s.notVoidableReason}</p>}
                  </button>
                ))}
            </div>
          </div>
        )}

        {step === 'confirm' && selected && (
          <>
            <div className="p-5 space-y-3 overflow-y-auto text-xs">
              <div className="bg-slate-50 rounded-xl p-3 space-y-1">
                <div className="flex justify-between text-slate-500 font-medium">
                  <span>{new Date(selected.createdAt).toLocaleString()}</span>
                  <span>
                    {selected.cashier} · {PAYMENT_LABELS[selected.paymentMethod] || selected.paymentMethod}
                  </span>
                </div>
                {selected.member && (
                  <div className="text-slate-500 font-medium">
                    Member: {selected.member.name} (#{selected.member.cardNumber}) — points earned on this sale will be taken back.
                  </div>
                )}
              </div>
              <div className="bg-slate-50 rounded-xl p-3 space-y-1">
                {selected.items.map((item, i) => (
                  <div key={i} className="flex justify-between gap-3 text-slate-600 font-semibold">
                    <span>
                      {item.quantity} &times; {item.name}
                    </span>
                    <span className="whitespace-nowrap">{php(item.subtotal)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-slate-500 font-medium pt-1 border-t border-slate-200">
                  <span>Subtotal</span>
                  <span>{php(selected.subtotal)}</span>
                </div>
                {selected.discountAmount > 0 && (
                  <div className="flex justify-between text-slate-500 font-medium">
                    <span>Discount</span>
                    <span>-{php(selected.discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-rose-600 font-bold">
                  <span>Amount to void</span>
                  <span>-{php(selected.totalAmount)}</span>
                </div>
              </div>
              <p className="text-slate-400 font-medium">The items go back into stock, and a void slip prints automatically. This can't be undone.</p>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Reason (required)</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={255}
                  rows={2}
                  placeholder="e.g., wrong item scanned"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 resize-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Supervisor PIN</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={(e) => e.key === 'Enter' && handleVoid()}
                    placeholder="4–6 digit PIN"
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
                  />
                </div>
              </div>
              {submitError && <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 font-semibold">{submitError}</div>}
            </div>
            <div className="p-5 border-t border-slate-100 shrink-0 flex gap-2">
              <button
                type="button"
                onClick={() => setStep('pick')}
                className="flex-1 py-2.5 bg-white border border-slate-200 text-slate-700 hover:border-indigo-300 rounded-full text-xs font-bold transition-colors cursor-pointer"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleVoid}
                disabled={isSubmitting || !reason.trim() || pin.length < 4}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-full text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                {isSubmitting ? 'Voiding…' : 'Authorize & Void'}
              </button>
            </div>
          </>
        )}

        {step === 'done' && result && (
          <>
            <div className="p-5 space-y-3 overflow-y-auto text-xs">
              <p className="text-slate-600 font-semibold">
                {result.transaction?.transactionNo} was voided ({php(result.totalAmount)}). The items are back in stock.
              </p>
              <div role="status" className={`p-3 rounded-xl font-semibold border ${status.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
                {status.message}
              </div>
            </div>
            <div className="p-5 border-t border-slate-100 shrink-0 flex gap-2">
              <button
                type="button"
                onClick={handleReprint}
                disabled={isReprinting}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-white border border-slate-200 text-slate-700 hover:border-indigo-300 hover:text-blue-600 rounded-full text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
              >
                <Printer className="w-4 h-4" />
                {isReprinting ? 'Printing…' : 'Reprint'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 bg-[#0B132B] hover:shadow-slate-900/30 shadow-lg text-white rounded-full text-xs font-bold transition-all cursor-pointer"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
