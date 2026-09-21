import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  FileText,
  Loader2,
  PackageSearch,
  Plus,
  Save,
  Send,
  Pencil,
  Trash2,
  Download,
} from 'lucide-react';
import { apiFetch } from '../../auth/apiFetch';
import SupplierCombobox from './SupplierCombobox';

const API_BASE_URL = 'http://localhost:5000/api';
const VAT_RATE = 0.12;
const TAGGING_OPTIONS = ['Regular', 'Urgent', 'Rush', 'Special Order'];

const emptyHeader = {
  poDate: () => new Date().toISOString().slice(0, 10),
  supplierId: '',
  shipTo: '',
  shippingAddress: '',
  tagging: 'Regular',
  purpose: '',
  remarks: '',
  terms: 'N/A',
};

const emptyQuickAdd = { barcode: '', description: '', shelf: '', category: '', uom: '', unitCost: '', qty: 1, productId: null };

async function downloadPurchaseOrderFile(purchaseOrder) {
  const res = await apiFetch(`${API_BASE_URL}/purchase-orders/${purchaseOrder.id}/export`);
  if (!res.ok) throw new Error(`Failed to export ${purchaseOrder.poNumber}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${purchaseOrder.poNumber}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const buildViewLineItems = (po) =>
  (po.items || []).map((it) => ({
    id: it.id,
    productId: it.product.id,
    barcode: it.product.barcode,
    description: it.product.name,
    shelf: '',
    category: it.product.category || '',
    uom: it.product.unit || 'PC/S',
    unitCost: Number(it.unitCost),
    qty: it.quantity,
  }));

const fieldLabelClass = 'block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1';
// Header details grid: dark/slate fields per the legacy PO Processing Module look.
const darkFieldClass =
  'w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3.5 py-2 text-xs font-medium placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all [color-scheme:dark] disabled:opacity-50 disabled:cursor-not-allowed';
// Quick-add row / summary strip: light fields for contrast against the dark header block.
const lightFieldClass =
  'w-full bg-white border border-slate-200 text-slate-800 rounded-xl px-3.5 py-2.5 text-xs font-medium placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all';

// mode: 'create' (new PO), 'edit' (a saved DRAFT), or 'view' (read-only, any other status)
export default function CreatePurchaseOrderModal({ isOpen, onClose, products, mode = 'create', purchaseOrder = null, onSaved }) {
  const isViewMode = mode === 'view';
  const isEditMode = mode === 'edit';

  const [poNumber, setPoNumber] = useState('Auto-generated on save');
  const [poDate, setPoDate] = useState(emptyHeader.poDate);
  const [supplierId, setSupplierId] = useState(emptyHeader.supplierId); // '' while the typed name matches no supplier
  const [supplierText, setSupplierText] = useState('');
  const [supplierRecords, setSupplierRecords] = useState([]);
  const [shipTo, setShipTo] = useState(emptyHeader.shipTo);
  const [shippingAddress, setShippingAddress] = useState(emptyHeader.shippingAddress);
  const [tagging, setTagging] = useState(emptyHeader.tagging);
  const [purpose, setPurpose] = useState(emptyHeader.purpose);
  const [remarks, setRemarks] = useState(emptyHeader.remarks);
  const [terms, setTerms] = useState(emptyHeader.terms);
  const [discount, setDiscount] = useState(0);

  const [lineItems, setLineItems] = useState([]);
  const [selectedLineItemId, setSelectedLineItemId] = useState(null);
  const [editingItemId, setEditingItemId] = useState(null);
  const [quickAdd, setQuickAdd] = useState(emptyQuickAdd);
  const [quickAddError, setQuickAddError] = useState('');

  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState(null);

  const nextIdRef = useRef(1);

  const resetForm = () => {
    setPoNumber('Auto-generated on save');
    setPoDate(emptyHeader.poDate());
    setSupplierId(emptyHeader.supplierId);
    setSupplierText('');
    setShipTo(emptyHeader.shipTo);
    setShippingAddress(emptyHeader.shippingAddress);
    setTagging(emptyHeader.tagging);
    setPurpose(emptyHeader.purpose);
    setRemarks(emptyHeader.remarks);
    setTerms(emptyHeader.terms);
    setDiscount(0);
    setLineItems([]);
    setSelectedLineItemId(null);
    setEditingItemId(null);
    setQuickAdd(emptyQuickAdd);
    setQuickAddError('');
    setError(null);
  };

  // Load the selected PO's saved data (view/edit), or a blank form (create), whenever the modal is (re)opened.
  const handleOpenReset = () => {
    resetForm();

    if ((isViewMode || isEditMode) && purchaseOrder) {
      setPoNumber(purchaseOrder.poNumber);
      setPoDate(new Date(purchaseOrder.createdAt).toISOString().slice(0, 10));
      setSupplierId(String(purchaseOrder.supplierId));
      setSupplierText(purchaseOrder.supplier?.name || '');
      setShipTo(purchaseOrder.shipTo || '');
      setShippingAddress(purchaseOrder.shippingAddress || '');
      setTagging(purchaseOrder.tagging || emptyHeader.tagging);
      setPurpose(purchaseOrder.purpose || '');
      setTerms(purchaseOrder.terms || 'N/A');
      setRemarks(purchaseOrder.remarks || '');
      setDiscount(Number(purchaseOrder.discount || 0));
      const items = buildViewLineItems(purchaseOrder);
      setLineItems(items);
      nextIdRef.current = items.length + 1;
    }
  };

  useEffect(() => {
    if (isOpen) {
      handleOpenReset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, purchaseOrder]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    apiFetch(`${API_BASE_URL}/suppliers`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) setSupplierRecords(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Address / contact always come from the supplier record, not from the PO form.
  const selectedSupplier =
    supplierRecords.find((s) => String(s.id) === String(supplierId)) ||
    (purchaseOrder && String(purchaseOrder.supplierId) === String(supplierId) ? purchaseOrder.supplier : null);

  // Every supplier on file (so a supplier created from an earlier PO shows up even before it has products),
  // plus any known only through the product list.
  const suppliers = useMemo(() => {
    const map = new Map();
    supplierRecords.forEach((s) => map.set(s.id, { id: s.id, name: s.name || 'N/A' }));
    products.forEach((p) => {
      if (p.supplierId && !map.has(p.supplierId)) {
        map.set(p.supplierId, { id: p.supplierId, name: p.supplierName || 'N/A' });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [products, supplierRecords]);

  const barcodeMap = useMemo(() => {
    const map = new Map();
    products.forEach((p) => {
      if (p.barcode) map.set(p.barcode, p);
    });
    return map;
  }, [products]);

  const handleBarcodeBlur = () => {
    const match = barcodeMap.get(quickAdd.barcode.trim());
    if (match) {
      setQuickAdd((prev) => ({
        ...prev,
        barcode: match.barcode,
        description: match.name,
        category: match.category || '',
        uom: match.unit || 'PC/S',
        unitCost: match.unitCost ?? 0,
        productId: match.id,
      }));
      setQuickAddError('');
    } else if (quickAdd.barcode.trim()) {
      setQuickAdd((prev) => ({ ...prev, productId: null }));
      setQuickAddError('No matching product for this barcode.');
    }
  };

  const handleAddOrUpdateItem = () => {
    if (!quickAdd.productId) {
      setQuickAddError('Scan or enter a valid product barcode first.');
      return;
    }
    const qty = Number(quickAdd.qty) || 0;
    if (qty <= 0) {
      setQuickAddError('Quantity must be at least 1.');
      return;
    }

    if (editingItemId) {
      setLineItems((prev) =>
        prev.map((li) => (li.id !== editingItemId ? li : { ...quickAdd, qty, unitCost: Number(quickAdd.unitCost) || 0, id: editingItemId }))
      );
      setEditingItemId(null);
    } else {
      setLineItems((prev) => {
        const existing = prev.find((li) => li.productId === quickAdd.productId);
        if (existing) {
          return prev.map((li) => (li.id !== existing.id ? li : { ...li, qty: Number(li.qty) + qty }));
        }
        return [
          ...prev,
          { ...quickAdd, qty, unitCost: Number(quickAdd.unitCost) || 0, id: nextIdRef.current++ },
        ];
      });
    }

    setQuickAdd(emptyQuickAdd);
    setQuickAddError('');
  };

  const handleEditItem = (item) => {
    setQuickAdd({ ...item });
    setEditingItemId(item.id);
    setQuickAddError('');
  };

  const handleCancelEdit = () => {
    setEditingItemId(null);
    setQuickAdd(emptyQuickAdd);
    setQuickAddError('');
  };

  const handleRemoveItem = (id) => {
    setLineItems((prev) => prev.filter((li) => li.id !== id));
    if (editingItemId === id) handleCancelEdit();
    if (selectedLineItemId === id) setSelectedLineItemId(null);
  };

  const handleClearAll = () => {
    setLineItems([]);
    setSelectedLineItemId(null);
    handleCancelEdit();
  };

  const handleDeleteSelected = () => {
    if (selectedLineItemId) handleRemoveItem(selectedLineItemId);
  };

  const handleEditSelected = () => {
    const item = lineItems.find((li) => li.id === selectedLineItemId);
    if (item) {
      handleEditItem(item);
      setSelectedLineItemId(null);
    }
  };

  const totalQty = useMemo(() => lineItems.reduce((sum, li) => sum + Number(li.qty), 0), [lineItems]);
  const grossAmount = useMemo(
    () => lineItems.reduce((sum, li) => sum + Number(li.qty) * Number(li.unitCost), 0),
    [lineItems]
  );
  const vatAmount = Math.round(grossAmount * 100 * VAT_RATE) / 100;
  const discountAmount = Number(discount) || 0;
  const netAmount = Math.max(grossAmount + vatAmount - discountAmount, 0);

  const handleDownload = async () => {
    if (!purchaseOrder) return;
    setIsDownloading(true);
    try {
      await downloadPurchaseOrderFile(purchaseOrder);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsDownloading(false);
    }
  };

  // An existing supplier goes by id; a name that matched nobody is sent as supplierName and created on save.
  const buildPayload = (status) => ({
    ...(supplierId ? { supplierId: Number(supplierId) } : { supplierName: supplierText.trim() }),
    items: lineItems.map((li) => ({
      productId: li.productId,
      quantity: Number(li.qty),
      unitCost: Number(li.unitCost),
    })),
    terms,
    remarks,
    discount: discountAmount,
    shipTo,
    shippingAddress,
    purpose,
    tagging,
    status,
  });

  const readError = async (res, fallback) => {
    const body = await res.json().catch(() => ({}));
    return body.error || fallback;
  };

  // Persist the form as a DRAFT (new) or update the existing draft; returns the saved PO.
  const saveDraft = async () => {
    const res = await apiFetch(
      isEditMode ? `${API_BASE_URL}/purchase-orders/${purchaseOrder.id}` : `${API_BASE_URL}/purchase-orders`,
      {
        method: isEditMode ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload('DRAFT')),
      }
    );
    if (!res.ok) throw new Error(await readError(res, 'Failed to save draft'));
    return res.json();
  };

  const validateForm = () => {
    if (!supplierId && !supplierText.trim()) return 'Select or type a supplier for this purchase order.';
    if (lineItems.length === 0) return 'Add at least one item to the purchase order.';
    return null;
  };

  const handleSaveDraft = async () => {
    setError(null);
    const problem = validateForm();
    if (problem) {
      setError(problem);
      return;
    }

    setIsSavingDraft(true);
    try {
      const saved = await saveDraft();
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleSubmit = async () => {
    setError(null);
    const problem = validateForm();
    if (problem) {
      setError(problem);
      return;
    }

    setIsSubmitting(true);
    try {
      let created;
      if (isEditMode) {
        // Save the latest edits, then promote the draft to a pending (receivable) order.
        await saveDraft();
        const res = await apiFetch(`${API_BASE_URL}/purchase-orders/${purchaseOrder.id}/submit`, { method: 'POST' });
        if (!res.ok) throw new Error(await readError(res, 'Failed to submit purchase order'));
        created = await res.json();
      } else {
        const res = await apiFetch(`${API_BASE_URL}/purchase-orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayload('PENDING')),
        });
        if (!res.ok) throw new Error(await readError(res, 'Failed to create purchase order'));
        created = await res.json();
      }

      await downloadPurchaseOrderFile(created);
      onSaved?.(created);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-modal-backdrop">
      <div className="font-sans bg-white rounded-2xl shadow-2xl shadow-slate-900/20 max-w-6xl w-full border border-slate-200/80 max-h-[92vh] flex flex-col animate-modal-card overflow-hidden">
        {/* Dark navy header accent */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#0B132B] border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/30">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-blue-400">PO Processing</p>
              <h3 className="text-lg font-black text-white tracking-tight">
                {isViewMode ? `Purchase Order — ${purchaseOrder?.poNumber || ''}` : isEditMode ? `Edit Draft — ${purchaseOrder?.poNumber || ''}` : 'Create Purchase Order'}
              </h3>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white hover:bg-white/10 p-2 rounded-full transition-colors cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isEditMode && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-[11px] font-semibold text-blue-700">
              This purchase order is a saved draft. It can't be received until you submit it.
            </div>
          )}

          {isViewMode && purchaseOrder && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[11px] font-semibold text-slate-500">
              Status: {purchaseOrder.status}. Only drafts can be edited.
            </div>
          )}

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">
              {error}
            </div>
          )}

          {/* HEADER FIELDS — 2-column form grid, dark/slate fields */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-4">
            <div className="space-y-4">
              <div>
                <label className={fieldLabelClass}>PO No.</label>
                <input type="text" disabled value={poNumber} className={darkFieldClass} />
              </div>
              <div>
                <label className={fieldLabelClass}>PO Date</label>
                <input type="date" disabled={isViewMode} value={poDate} onChange={(e) => setPoDate(e.target.value)} className={darkFieldClass} />
              </div>
              <div>
                <label className={fieldLabelClass}>Supplier</label>
                <SupplierCombobox
                  disabled={isViewMode}
                  value={{ id: supplierId, text: supplierText }}
                  options={suppliers}
                  onChange={({ id, text }) => {
                    setSupplierId(id);
                    setSupplierText(text);
                  }}
                  inputClassName={darkFieldClass}
                />
              </div>
              <div>
                <label className={fieldLabelClass}>Address</label>
                <input type="text" disabled value={selectedSupplier?.address || ''} placeholder={supplierText.trim() && !supplierId ? 'New supplier: not set yet' : 'From the supplier record'} className={darkFieldClass} />
              </div>
              <div>
                <label className={fieldLabelClass}>Contact Person</label>
                <input type="text" disabled value={selectedSupplier?.contactPerson || ''} placeholder={supplierText.trim() && !supplierId ? 'New supplier: not set yet' : 'From the supplier record'} className={darkFieldClass} />
              </div>
              <div>
                <label className={fieldLabelClass}>Contact No.</label>
                <input type="text" disabled value={selectedSupplier?.phone || ''} placeholder={supplierText.trim() && !supplierId ? 'New supplier: not set yet' : 'From the supplier record'} className={darkFieldClass} />
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className={fieldLabelClass}>Ship To</label>
                <input type="text" disabled={isViewMode} value={shipTo} onChange={(e) => setShipTo(e.target.value)} placeholder={isViewMode ? '—' : 'Defaults to the co-op on the printed PO'} className={darkFieldClass} />
              </div>
              <div>
                <label className={fieldLabelClass}>Shipping Address</label>
                <input type="text" disabled={isViewMode} value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)} placeholder={isViewMode ? '—' : 'Defaults to the co-op address on the printed PO'} className={darkFieldClass} />
              </div>
              <div>
                <label className={fieldLabelClass}>Tagging</label>
                <select disabled={isViewMode} value={tagging} onChange={(e) => setTagging(e.target.value)} className={darkFieldClass}>
                  {TAGGING_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={fieldLabelClass}>Purpose</label>
                <input type="text" disabled={isViewMode} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={isViewMode ? '—' : 'e.g., Weekly stock replenishment'} className={darkFieldClass} />
              </div>
              <div>
                <label className={fieldLabelClass}>Remarks</label>
                <input type="text" disabled={isViewMode} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional notes" className={darkFieldClass} />
              </div>
              <div>
                <label className={fieldLabelClass}>Terms</label>
                <input type="text" disabled={isViewMode} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="e.g., N/A, COD, Net 30" className={darkFieldClass} />
              </div>
            </div>
          </div>

          {/* ITEM QUICK-ADD ROW */}
          {!isViewMode && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                {editingItemId ? 'Edit Line Item' : 'Add Line Item'}
              </p>
              <datalist id="po-barcode-options">
                {products.filter((p) => p.barcode).map((p) => (
                  <option key={p.id} value={p.barcode}>{p.name}</option>
                ))}
              </datalist>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 items-end">
                <div className="lg:col-span-1">
                  <label className={fieldLabelClass}>Barcode</label>
                  <input
                    type="text"
                    list="po-barcode-options"
                    value={quickAdd.barcode}
                    onChange={(e) => setQuickAdd((prev) => ({ ...prev, barcode: e.target.value }))}
                    onBlur={handleBarcodeBlur}
                    placeholder="Scan barcode"
                    className={lightFieldClass}
                  />
                </div>
                <div className="lg:col-span-2">
                  <label className={fieldLabelClass}>Description</label>
                  <input
                    type="text"
                    value={quickAdd.description}
                    onChange={(e) => setQuickAdd((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="Item name"
                    className={lightFieldClass}
                  />
                </div>
                <div>
                  <label className={fieldLabelClass}>Shelf</label>
                  <input
                    type="text"
                    value={quickAdd.shelf}
                    onChange={(e) => setQuickAdd((prev) => ({ ...prev, shelf: e.target.value }))}
                    placeholder="e.g., A1"
                    className={lightFieldClass}
                  />
                </div>
                <div>
                  <label className={fieldLabelClass}>Category</label>
                  <input
                    type="text"
                    value={quickAdd.category}
                    onChange={(e) => setQuickAdd((prev) => ({ ...prev, category: e.target.value }))}
                    placeholder="Category"
                    className={lightFieldClass}
                  />
                </div>
                <div>
                  <label className={fieldLabelClass}>UOM</label>
                  <input
                    type="text"
                    value={quickAdd.uom}
                    onChange={(e) => setQuickAdd((prev) => ({ ...prev, uom: e.target.value }))}
                    placeholder="PC/S"
                    className={lightFieldClass}
                  />
                </div>
                <div>
                  <label className={fieldLabelClass}>Cost (VAT)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={quickAdd.unitCost}
                    onChange={(e) => setQuickAdd((prev) => ({ ...prev, unitCost: e.target.value }))}
                    placeholder="0.00"
                    className={`${lightFieldClass} [color-scheme:light]`}
                  />
                </div>
                <div>
                  <label className={fieldLabelClass}>Add Quantity</label>
                  <input
                    type="number"
                    min="1"
                    value={quickAdd.qty}
                    onChange={(e) => setQuickAdd((prev) => ({ ...prev, qty: e.target.value }))}
                    className={`${lightFieldClass} [color-scheme:light]`}
                  />
                </div>
              </div>
              {quickAddError && <p className="text-[11px] font-semibold text-rose-600">{quickAddError}</p>}
              <div className="flex items-center gap-2 justify-end">
                {editingItemId && (
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="px-4 py-2 bg-white border border-slate-200 text-slate-600 font-bold text-xs rounded-xl hover:bg-slate-50 transition cursor-pointer"
                  >
                    Cancel Edit
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleAddOrUpdateItem}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-tr from-blue-600 to-emerald-600 hover:shadow-lg hover:shadow-blue-500/30 text-white font-bold text-xs rounded-xl shadow-md transition cursor-pointer"
                >
                  {editingItemId ? <Save className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                  {editingItemId ? 'Update Item' : 'Add'}
                </button>
              </div>
            </div>
          )}

          {/* ITEM TABLE */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600 font-extrabold uppercase text-[10px] tracking-wider border-b-2 border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Barcode</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 text-center">Qty</th>
                    <th className="px-4 py-3 text-center">UOM</th>
                    <th className="px-4 py-3 text-right">Unit Price</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lineItems.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="px-4 py-10 text-center text-slate-400">
                        <div className="flex flex-col items-center gap-2">
                          <PackageSearch className="w-6 h-6" />
                          <span>No items added yet — scan or enter a barcode above.</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    lineItems.map((li) => (
                      <tr
                        key={li.id}
                        onClick={isViewMode ? undefined : () => setSelectedLineItemId((prev) => (prev === li.id ? null : li.id))}
                        className={`transition-colors ${isViewMode ? '' : 'cursor-pointer hover:bg-slate-50'} ${
                          selectedLineItemId === li.id || editingItemId === li.id ? 'bg-blue-50/70' : ''
                        }`}
                      >
                        <td className="px-4 py-3 font-mono text-slate-500">{li.barcode}</td>
                        <td className="px-4 py-3 font-semibold text-slate-800">{li.description}</td>
                        <td className="px-4 py-3 text-center text-slate-700">{li.qty}</td>
                        <td className="px-4 py-3 text-center text-slate-500">{li.uom}</td>
                        <td className="px-4 py-3 text-right text-slate-700">₱{Number(li.unitCost).toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900">₱{(Number(li.qty) * Number(li.unitCost)).toFixed(2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* FOOTER SUMMARY & ACTION TOOLBAR */}
        <div className="p-5 border-t border-slate-100 bg-slate-50/50 flex flex-col gap-4 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-5 text-xs">
              <span className="text-slate-500 font-semibold">
                Total Qty: <span className="text-slate-900 font-black">{totalQty}</span>
              </span>
              <span className="text-slate-500 font-semibold">
                VAT (12%): <span className="text-slate-900 font-black">₱{vatAmount.toFixed(2)}</span>
              </span>
              {!isViewMode ? (
                <label className="flex items-center gap-2 text-slate-500 font-semibold">
                  Less Discount (₱)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    className="w-24 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 [color-scheme:light]"
                  />
                </label>
              ) : (
                <span className="text-slate-500 font-semibold">
                  Less Discount: <span className="text-slate-900 font-black">₱{discountAmount.toFixed(2)}</span>
                </span>
              )}
              <span className="text-slate-500 font-semibold">
                Net Amount: <span className="text-base text-slate-900 font-black">₱{netAmount.toFixed(2)}</span>
              </span>
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            {isViewMode ? (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 transition cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={isDownloading}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-tr from-emerald-600 to-teal-600 hover:shadow-lg hover:shadow-emerald-500/30 text-white font-bold text-xs rounded-xl shadow-md transition disabled:opacity-50 cursor-pointer"
                >
                  {isDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  {isDownloading ? 'Downloading...' : 'Download PO (.xlsx)'}
                </button>
              </>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 w-full">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDeleteSelected}
                    disabled={!selectedLineItemId}
                    className="flex items-center gap-1.5 px-4 py-2 bg-white border border-rose-200 text-rose-600 font-bold text-[11px] uppercase tracking-wide rounded-xl hover:bg-rose-50 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="px-4 py-2 bg-white border border-slate-200 text-slate-600 font-bold text-[11px] uppercase tracking-wide rounded-xl hover:bg-slate-50 transition cursor-pointer"
                  >
                    Delete All
                  </button>
                  <button
                    type="button"
                    onClick={handleEditSelected}
                    disabled={!selectedLineItemId}
                    className="flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 text-slate-600 font-bold text-[11px] uppercase tracking-wide rounded-xl hover:bg-slate-50 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveDraft}
                    disabled={isSavingDraft || isSubmitting}
                    className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-tr from-blue-600 to-indigo-600 hover:shadow-lg hover:shadow-blue-500/30 text-white font-bold text-[11px] uppercase tracking-wide rounded-xl shadow-md transition disabled:opacity-50 cursor-pointer"
                  >
                    {isSavingDraft ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    {isSavingDraft ? 'Saving...' : 'Save Draft'}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold text-[11px] uppercase tracking-wide rounded-xl hover:bg-slate-50 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={isSubmitting || isSavingDraft}
                    className="flex items-center gap-1.5 px-5 py-2 bg-gradient-to-tr from-emerald-600 to-teal-600 hover:shadow-lg hover:shadow-emerald-500/30 text-white font-bold text-[11px] uppercase tracking-wide rounded-xl shadow-md transition disabled:opacity-50 cursor-pointer"
                  >
                    {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    {isSubmitting ? 'Submitting...' : 'Submit'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
