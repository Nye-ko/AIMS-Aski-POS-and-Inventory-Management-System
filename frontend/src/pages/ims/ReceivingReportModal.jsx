import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { X, ClipboardCheck, Loader2, Inbox, ChevronLeft } from 'lucide-react';

import { apiFetch } from '../../auth/apiFetch';

const API_BASE_URL = 'http://localhost:5000/api';

async function downloadReceivingReportFile(receivingReport) {
  const res = await apiFetch(`${API_BASE_URL}/receiving-reports/${receivingReport.id}/export`);
  if (!res.ok) throw new Error(`Failed to export ${receivingReport.rrNumber}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${receivingReport.rrNumber}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const buildLineItems = (po) =>
  (po.items || []).map((it) => ({
    productId: it.product.id,
    barcode: it.product.barcode,
    name: it.product.name,
    unit: it.product.unit || 'PC/S',
    orderedQty: it.quantity,
    checked: true,
    quantity: it.quantity,
    unitCost: Number(it.unitCost),
  }));

export default function ReceivingReportModal({ isOpen, onClose, onSaved, initialPurchaseOrder = null }) {
  const { token, logout } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState('list'); // 'list' | 'detail'
  const [pendingOrders, setPendingOrders] = useState([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [listError, setListError] = useState(null);

  const [selectedPo, setSelectedPo] = useState(null);
  const [items, setItems] = useState([]);
  const [deliveryNote, setDeliveryNote] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const loadPendingOrders = async () => {
    setIsLoadingList(true);
    setListError(null);
    try {
      const res = await apiFetch(`${API_BASE_URL}/purchase-orders/pending`);
      if (!res.ok) throw new Error('Failed to load pending purchase orders');
      setPendingOrders(await res.json());
    } catch (err) {
      setListError(err.message);
    } finally {
      setIsLoadingList(false);
    }
  };

  const openPurchaseOrder = (po) => {
    setSelectedPo(po);
    setItems(buildLineItems(po));
    setDeliveryNote('');
    setInvoiceNo('');
    setRemarks('');
    setFormError(null);
    setView('detail');
  };

  // Jump straight to the given PO if one was passed in, otherwise reset to
  // the pending-orders picker list — each time the modal is (re)opened.
  const prevIsOpen = React.useRef(isOpen);
  useEffect(() => {
    if (isOpen && !prevIsOpen.current) {
      if (initialPurchaseOrder) {
        setSelectedPo(initialPurchaseOrder);
        setItems(buildLineItems(initialPurchaseOrder));
        setDeliveryNote('');
        setInvoiceNo('');
        setRemarks('');
        setFormError(null);
        setView('detail');
      } else {
        setView('list');
        setSelectedPo(null);
        setFormError(null);
        loadPendingOrders();
      }
    }
    prevIsOpen.current = isOpen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const updateItem = (productId, patch) => {
    setItems((prev) => prev.map((it) => (it.productId !== productId ? it : { ...it, ...patch })));
  };

  const handleCreateReport = async () => {
    setFormError(null);
    const eligibleItems = items
      .filter((it) => it.checked && it.quantity > 0)
      .map((it) => ({ productId: it.productId, quantity: Number(it.quantity), unitCost: Number(it.unitCost) }));

    if (eligibleItems.length === 0) {
      setFormError('Select at least one received product to include in the report.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/receiving-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          purchaseOrderId: selectedPo.id,
          items: eligibleItems,
          deliveryNote,
          invoiceNo,
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
        throw new Error(body.error || 'Failed to create receiving report');
      }

      const receivingReport = await res.json();
      await downloadReceivingReportFile(receivingReport);
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
            {view === 'detail' && !initialPurchaseOrder && (
              <button onClick={() => setView('list')} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-full transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <ClipboardCheck className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">
              {view === 'list' ? 'Create Receiving Report — Pending Purchase Orders' : `Receiving Report — ${selectedPo?.poNumber}`}
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
                  <Loader2 className="w-5 h-5 animate-spin" /> Loading pending purchase orders...
                </div>
              )}
              {listError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">
                  {listError}
                </div>
              )}
              {!isLoadingList && !listError && pendingOrders.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400 text-sm gap-2">
                  <Inbox className="w-8 h-8" />
                  <p>No pending purchase orders are awaiting a Receiving Report.</p>
                </div>
              )}
              {!isLoadingList &&
                pendingOrders.map((po) => (
                  <button
                    key={po.id}
                    onClick={() => openPurchaseOrder(po)}
                    className="w-full flex items-center justify-between border border-slate-200 rounded-2xl px-4 py-3 hover:border-emerald-300 hover:bg-emerald-50/40 transition text-left"
                  >
                    <div>
                      <p className="text-xs font-black text-slate-800">{po.poNumber}</p>
                      <p className="text-[11px] text-slate-500">{po.supplier?.name} — {po.items.length} item(s)</p>
                    </div>
                    <p className="text-xs font-bold text-slate-600">₱{Number(po.totalAmount).toFixed(2)}</p>
                  </button>
                ))}
            </>
          )}

          {view === 'detail' && selectedPo && (
            <>
              {formError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">DR Number</label>
                  <input
                    type="text"
                    value={deliveryNote}
                    onChange={(e) => setDeliveryNote(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Invoice No.</label>
                  <input
                    type="text"
                    value={invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Supplier</label>
                  <input
                    type="text"
                    value={selectedPo.supplier?.name || ''}
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
                    <th className="p-2 text-center">Ordered</th>
                    <th className="p-2 text-center w-24">Qty Received</th>
                    <th className="p-2 text-center w-28">Unit Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item) => (
                    <tr key={item.productId} className={!item.checked ? 'opacity-40' : ''}>
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={item.checked}
                          onChange={(e) => updateItem(item.productId, { checked: e.target.checked })}
                        />
                      </td>
                      <td className="p-2">
                        <p className="font-semibold text-slate-800">{item.name}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{item.barcode}</p>
                      </td>
                      <td className="p-2 text-center text-slate-500">{item.orderedQty} {item.unit}</td>
                      <td className="p-2">
                        <input
                          type="number"
                          min="0"
                          value={item.quantity}
                          onChange={(e) => updateItem(item.productId, { quantity: parseInt(e.target.value, 10) || 0 })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-center text-xs"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unitCost}
                          onChange={(e) => updateItem(item.productId, { unitCost: parseFloat(e.target.value) || 0 })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-center text-xs"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        {view === 'detail' && (
          <div className="p-5 border-t border-slate-100 flex justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={initialPurchaseOrder ? onClose : () => setView('list')}
              className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 transition"
            >
              {initialPurchaseOrder ? 'Cancel' : 'Back'}
            </button>
            <button
              type="button"
              onClick={handleCreateReport}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-tr from-emerald-600 to-teal-600 hover:shadow-lg hover:shadow-emerald-500/30 text-white font-bold text-xs rounded-xl shadow-md transition disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSubmitting ? 'Saving & Generating...' : 'Create Report & Download'}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
