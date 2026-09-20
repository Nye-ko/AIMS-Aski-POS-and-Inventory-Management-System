import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { X, RotateCcw, Loader2, Inbox, ChevronLeft } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';

import { apiFetch } from '../../auth/apiFetch';

const API_BASE_URL = 'http://localhost:5000/api';
const REASON_OPTIONS = ['Damaged', 'Expired', 'Incorrect Item', 'Overstock', 'Retail'];

async function downloadPurchaseReturnFile(purchaseReturn) {
  const res = await apiFetch(`${API_BASE_URL}/purchase-returns/${purchaseReturn.id}/export`);
  if (!res.ok) throw new Error(`Failed to export ${purchaseReturn.returnNo}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${purchaseReturn.returnNo}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const buildLineItems = (rr) =>
  (rr.items || []).map((it) => ({
    productId: it.product.id,
    barcode: it.product.barcode,
    name: it.product.name,
    unit: it.product.unit || 'PC/S',
    receivedQty: it.quantity,
    currentStock: it.product.stock,
    unitCost: Number(it.unitCost),
    checked: false,
    quantity: Math.min(it.quantity, it.product.stock) || 0,
  }));

export default function PurchaseReturnModal({ isOpen, onClose, onSaved }) {
  const { token, logout } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState('list'); // 'list' | 'detail'
  const [receivingReports, setReceivingReports] = useState([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [listError, setListError] = useState(null);

  const [selectedRr, setSelectedRr] = useState(null);
  const [items, setItems] = useState([]);
  const [reason, setReason] = useState(REASON_OPTIONS[0]);
  const [remarks, setRemarks] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const loadReceivingReports = async () => {
    setIsLoadingList(true);
    setListError(null);
    try {
      const res = await apiFetch(`${API_BASE_URL}/receiving-reports`);
      if (!res.ok) throw new Error('Failed to load receiving reports');
      setReceivingReports(await res.json());
    } catch (err) {
      setListError(err.message);
    } finally {
      setIsLoadingList(false);
    }
  };

  // Reset to the picker list each time the modal is (re)opened
  const prevIsOpen = React.useRef(isOpen);
  useEffect(() => {
    if (isOpen && !prevIsOpen.current) {
      setView('list');
      setSelectedRr(null);
      setFormError(null);
      loadReceivingReports();
    }
    prevIsOpen.current = isOpen;
  }, [isOpen]);

  const openReceivingReport = (rr) => {
    setSelectedRr(rr);
    setItems(buildLineItems(rr));
    setReason(REASON_OPTIONS[0]);
    setRemarks('');
    setFormError(null);
    setView('detail');
  };

  const updateItem = (productId, patch) => {
    setItems((prev) => prev.map((it) => (it.productId !== productId ? it : { ...it, ...patch })));
  };

  const handleCreateReturn = async () => {
    setFormError(null);
    const eligibleItems = items
      .filter((it) => it.checked && it.quantity > 0)
      .map((it) => ({ productId: it.productId, quantity: Number(it.quantity) }));

    if (eligibleItems.length === 0) {
      setFormError('Select at least one product to return.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/purchase-returns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          receivingReportId: selectedRr.id,
          items: eligibleItems,
          reason,
          remarks,
        }),
      });

      if (res.status === 401) {
        logout();
        navigate('/', { replace: true });
        throw new Error('Your session is no longer valid. Please log in again.');
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to create purchase return');
      }

      const purchaseReturn = await res.json();
      await downloadPurchaseReturnFile(purchaseReturn);
      onSaved?.();
      onClose();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-modal-backdrop">
      <div className="font-sans bg-white rounded-2xl shadow-2xl shadow-slate-900/10 max-w-4xl w-full border border-slate-200/80 max-h-[90vh] flex flex-col animate-modal-card">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            {view === 'detail' && (
              <button onClick={() => setView('list')} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-full transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
              <RotateCcw className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">
              {view === 'list' ? 'Create Purchase Return — Receiving Reports' : `Purchase Return — ${selectedRr?.rrNumber}`}
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-full transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {view === 'list' && (
            <>
              {isLoadingList && (
                <div className="flex items-center justify-center py-12 text-slate-400 gap-2 text-sm">
                  <Loader2 className="w-5 h-5 animate-spin" /> Loading receiving reports...
                </div>
              )}
              {listError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">
                  {listError}
                </div>
              )}
              {!isLoadingList && !listError && receivingReports.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400 text-sm gap-2">
                  <Inbox className="w-8 h-8" />
                  <p>No receiving reports have been filed yet.</p>
                </div>
              )}
              {!isLoadingList &&
                receivingReports.map((rr) => (
                  <button
                    key={rr.id}
                    onClick={() => openReceivingReport(rr)}
                    className="w-full flex items-center justify-between border border-slate-200 rounded-2xl px-4 py-3 hover:border-rose-300 hover:bg-rose-50/40 transition text-left"
                  >
                    <div>
                      <p className="text-xs font-black text-slate-800">{rr.rrNumber}</p>
                      <p className="text-[11px] text-slate-500">
                        {rr.supplier?.name} — {rr.items.length} item(s) — received {new Date(rr.receivedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </button>
                ))}
            </>
          )}

          {view === 'detail' && selectedRr && (
            <>
              {formError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Reason for Return</label>
                  <select
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs font-semibold"
                  >
                    {REASON_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Supplier</label>
                  <input
                    type="text"
                    value={selectedRr.supplier?.name || ''}
                    disabled
                    className="w-full bg-slate-100 border border-slate-200 rounded-xl p-2 text-xs text-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Source Receiving Report</label>
                  <input
                    type="text"
                    value={selectedRr.rrNumber}
                    disabled
                    className="w-full bg-slate-100 border border-slate-200 rounded-xl p-2 text-xs text-slate-500"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-xs font-bold text-slate-600 mb-1">Remarks</label>
                  <textarea
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    rows={2}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs"
                  />
                </div>
              </div>

              <table className="w-full text-left text-xs border border-slate-200 rounded-2xl overflow-hidden">
                <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] border-b border-slate-100">
                  <tr>
                    <th className="p-2 w-8"></th>
                    <th className="p-2">Product</th>
                    <th className="p-2 text-center">Received</th>
                    <th className="p-2 text-center">In Stock</th>
                    <th className="p-2 text-center w-24">Qty to Return</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item) => {
                    const maxQty = Math.min(item.receivedQty, item.currentStock);
                    return (
                      <tr key={item.productId} className={!item.checked ? 'opacity-40' : ''}>
                        <td className="p-2">
                          <input
                            type="checkbox"
                            checked={item.checked}
                            disabled={maxQty <= 0}
                            onChange={(e) => updateItem(item.productId, { checked: e.target.checked })}
                          />
                        </td>
                        <td className="p-2">
                          <p className="font-semibold text-slate-800">{item.name}</p>
                          <p className="text-[10px] text-slate-400 font-mono">{item.barcode}</p>
                        </td>
                        <td className="p-2 text-center text-slate-500">{item.receivedQty} {item.unit}</td>
                        <td className="p-2 text-center text-slate-500">{item.currentStock}</td>
                        <td className="p-2">
                          <input
                            type="number"
                            min="0"
                            max={maxQty}
                            value={item.quantity}
                            onChange={(e) =>
                              updateItem(item.productId, {
                                quantity: Math.max(0, Math.min(maxQty, parseInt(e.target.value, 10) || 0)),
                              })
                            }
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-center text-xs"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>

        {view === 'detail' && (
          <div className="p-5 border-t border-slate-100 flex justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setView('list')}
              className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 transition"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleCreateReturn}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-tr from-rose-600 to-pink-600 hover:shadow-lg hover:shadow-rose-500/30 text-white font-bold text-xs rounded-xl shadow-md transition disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSubmitting ? 'Saving & Generating...' : 'Create Return & Download'}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
