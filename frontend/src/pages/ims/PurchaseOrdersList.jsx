import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, ClipboardList, Loader2, Inbox, Plus, FolderOpen, Trash2, ClipboardCheck, Eye, Ban } from 'lucide-react';
import CreatePurchaseOrderModal from './CreatePurchaseOrderModal';
import ReceivingReportModal from './ReceivingReportModal';
import ViewReceivingReportModal from './ViewReceivingReportModal';

import { apiFetch } from '../../auth/apiFetch';

const API_BASE_URL = 'http://localhost:5000/api';

const STATUS_STYLES = {
  DRAFT: 'bg-slate-100 text-slate-600 border-slate-300',
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  RECEIVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CANCELLED: 'bg-rose-50 text-rose-600 border-rose-200',
};

export default function PurchaseOrdersList({ isOpen, onClose, products }) {

  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [listError, setListError] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [viewingPO, setViewingPO] = useState(null);
  const [receivingPO, setReceivingPO] = useState(null);
  const [viewingReceivingReportId, setViewingReceivingReportId] = useState(null);

  const [confirmingAction, setConfirmingAction] = useState(null); // 'delete' | 'cancel'
  const [isActing, setIsActing] = useState(false);
  const [actionError, setActionError] = useState(null);

  const fetchPurchaseOrders = async () => {
    setIsLoading(true);
    setListError(null);
    try {
      const res = await apiFetch(`${API_BASE_URL}/purchase-orders`);
      if (!res.ok) throw new Error('Failed to load purchase orders');
      setPurchaseOrders(await res.json());
    } catch (err) {
      setListError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setSelectedId(null);
      setConfirmingAction(null);
      setActionError(null);
      fetchPurchaseOrders();
    }
  }, [isOpen]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return purchaseOrders;
    return purchaseOrders.filter((po) => po.poNumber.toLowerCase().includes(q));
  }, [purchaseOrders, search]);

  const selectedPO = purchaseOrders.find((po) => po.id === selectedId) || null;

  const handleRowClick = (id) => {
    setSelectedId((prev) => (prev === id ? null : id));
    setConfirmingAction(null);
    setActionError(null);
  };

  const handleOpenSelected = () => {
    if (selectedPO) setViewingPO(selectedPO);
  };

  const handleCreated = () => {
    fetchPurchaseOrders();
  };

  const canCancel = selectedPO && ['DRAFT', 'PENDING'].includes(selectedPO.status);
  const canDelete = selectedPO && ['DRAFT', 'CANCELLED'].includes(selectedPO.status);

  const handleConfirmedAction = async () => {
    if (!selectedPO || !confirmingAction) return;
    setIsActing(true);
    setActionError(null);
    try {
      const res =
        confirmingAction === 'delete'
          ? await apiFetch(`${API_BASE_URL}/purchase-orders/${selectedPO.id}`, { method: 'DELETE' })
          : await apiFetch(`${API_BASE_URL}/purchase-orders/${selectedPO.id}/cancel`, { method: 'POST' });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to ${confirmingAction} purchase order`);
      }

      if (confirmingAction === 'delete') {
        setPurchaseOrders((prev) => prev.filter((po) => po.id !== selectedPO.id));
        setSelectedId(null);
      } else {
        await fetchPurchaseOrders();
      }
      setConfirmingAction(null);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setIsActing(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-modal-backdrop">
      <div className="font-sans bg-white rounded-2xl shadow-2xl shadow-slate-900/20 max-w-5xl w-full border border-slate-200/80 max-h-[88vh] flex flex-col animate-modal-card overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/30">
              <ClipboardList className="w-5 h-5" />
            </div>
            <h3 className="text-xl font-black text-slate-800 tracking-tight">Purchase Orders</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-full transition-colors cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 pt-5 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Purchase Order Number"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
            />
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600 font-extrabold uppercase text-[10px] tracking-wider border-b-2 border-slate-200">
                <tr>
                  <th className="px-4 py-3">PO Number</th>
                  <th className="px-4 py-3">Date Created</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">Net Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading && (
                  <tr>
                    <td colSpan="6" className="px-4 py-10 text-center text-slate-400">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading purchase orders...
                      </div>
                    </td>
                  </tr>
                )}
                {!isLoading && listError && (
                  <tr>
                    <td colSpan="6" className="px-4 py-8 text-center text-rose-600 font-semibold">
                      {listError}
                    </td>
                  </tr>
                )}
                {!isLoading && !listError && filteredOrders.length === 0 && (
                  <tr>
                    <td colSpan="6" className="px-4 py-10 text-center text-slate-400">
                      <div className="flex flex-col items-center gap-2">
                        <Inbox className="w-6 h-6" />
                        <span>{search ? 'No purchase orders match your search.' : 'No purchase orders yet.'}</span>
                      </div>
                    </td>
                  </tr>
                )}
                {!isLoading &&
                  !listError &&
                  filteredOrders.map((po) => (
                    <tr
                      key={po.id}
                      onClick={() => handleRowClick(po.id)}
                      className={`cursor-pointer transition-colors hover:bg-slate-50 ${selectedId === po.id ? 'bg-blue-50/70' : ''}`}
                    >
                      <td className="px-4 py-3 font-bold text-slate-800">{po.poNumber}</td>
                      <td className="px-4 py-3 text-slate-500">{new Date(po.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-slate-600">{po.supplier?.name || 'N/A'}</td>
                      <td className="px-4 py-3 font-bold text-slate-900">₱{Number(po.totalAmount).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block border text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full ${STATUS_STYLES[po.status] || STATUS_STYLES.DRAFT}`}>
                          {po.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {po.status === 'DRAFT' || po.status === 'CANCELLED' ? (
                          <span className="text-slate-300">—</span>
                        ) : po.receivingReport ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setViewingReceivingReportId(po.receivingReport.id);
                            }}
                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 text-xs px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            View Receiving Report
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setReceivingPO(po);
                            }}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-3 py-1.5 rounded-lg font-medium transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                          >
                            <ClipboardCheck className="w-3.5 h-3.5" />
                            Create Receiving Report
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Bottom action toolbar */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 shrink-0 space-y-3">
          {actionError && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">
              {actionError}
            </div>
          )}

          {confirmingAction ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold text-slate-700">
                {confirmingAction === 'delete' ? 'Delete' : 'Cancel'} <span className="font-black">{selectedPO?.poNumber}</span>?{' '}
                {confirmingAction === 'delete' ? "This can't be undone." : 'It can no longer be received.'}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingAction(null)}
                  className="px-4 py-2 bg-white border border-slate-200 text-slate-600 font-bold text-xs rounded-xl hover:bg-slate-50 transition cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleConfirmedAction}
                  disabled={isActing}
                  className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-rose-500/20 transition disabled:opacity-50 cursor-pointer"
                >
                  {isActing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {isActing ? 'Working...' : confirmingAction === 'delete' ? 'Confirm Delete' : 'Confirm Cancel PO'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsCreateOpen(true)}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl px-5 py-2.5 font-semibold text-xs shadow-lg shadow-blue-500/20 transition cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                New
              </button>
              <button
                type="button"
                onClick={handleOpenSelected}
                disabled={!selectedPO}
                className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 rounded-xl px-4 py-2.5 font-semibold text-xs hover:bg-slate-50 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <FolderOpen className="w-4 h-4" />
                Open
              </button>
              <button
                type="button"
                onClick={() => setConfirmingAction('cancel')}
                disabled={!canCancel}
                className="flex items-center gap-2 text-amber-700 hover:bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 font-semibold text-xs transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <Ban className="w-4 h-4" />
                Cancel PO
              </button>
              <button
                type="button"
                onClick={() => setConfirmingAction('delete')}
                disabled={!canDelete}
                className="flex items-center gap-2 text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5 font-semibold text-xs transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      <CreatePurchaseOrderModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        products={products}
        mode="create"
        onSaved={handleCreated}
      />
      <CreatePurchaseOrderModal
        isOpen={!!viewingPO}
        onClose={() => setViewingPO(null)}
        products={products}
        mode={viewingPO?.status === 'DRAFT' ? 'edit' : 'view'}
        purchaseOrder={viewingPO}
        onSaved={handleCreated}
      />

      <ReceivingReportModal
        isOpen={!!receivingPO}
        onClose={() => setReceivingPO(null)}
        initialPurchaseOrder={receivingPO}
        onSaved={fetchPurchaseOrders}
      />

      <ViewReceivingReportModal
        isOpen={!!viewingReceivingReportId}
        onClose={() => setViewingReceivingReportId(null)}
        receivingReportId={viewingReceivingReportId}
      />
    </div>,
    document.body
  );
}
