import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, FileText, Loader2, PackageSearch } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';

const API_BASE_URL = 'http://localhost:5000/api';
const LOW_STOCK_THRESHOLD = 15;

const getStockValue = (product) => Number(product.currentStock ?? product.stock ?? product.quantity ?? 0);

// Builds the initial per-supplier line-item state from the current product list.
const buildSupplierGroups = (products) => {
  const lowStock = products.filter((p) => getStockValue(p) < LOW_STOCK_THRESHOLD && p.supplierId);

  const bySupplier = new Map();
  lowStock.forEach((p) => {
    const key = p.supplierId;
    if (!bySupplier.has(key)) {
      bySupplier.set(key, { supplierId: key, supplierName: p.supplierName, items: [] });
    }
    const stock = getStockValue(p);
    const suggestedQty = Math.max((p.minStock || 10) - stock, 1);
    bySupplier.get(key).items.push({
      productId: p.id,
      barcode: p.barcode,
      name: p.name,
      stock,
      minStock: p.minStock,
      checked: true,
      quantity: suggestedQty,
      unitCost: Number(p.unitCost || 0),
      unit: p.unit || 'PC/S',
    });
  });

  return Array.from(bySupplier.values());
};

async function downloadPurchaseOrderFile(purchaseOrder) {
  const res = await fetch(`${API_BASE_URL}/purchase-orders/${purchaseOrder.id}/export`);
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

export default function PurchaseOrderModal({ isOpen, onClose, products }) {
  const { user, token, logout } = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState(() => buildSupplierGroups(products));
  const [terms, setTerms] = useState('N/A');
  const [remarks, setRemarks] = useState('');
  const [preparedBy, setPreparedBy] = useState(user?.username || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Rebuild the checklist from the latest product data whenever the modal is (re)opened
  const handleOpenReset = () => {
    setGroups(buildSupplierGroups(products));
    setPreparedBy(user?.username || '');
    setError(null);
  };

  const prevIsOpen = React.useRef(isOpen);
  if (isOpen && !prevIsOpen.current) {
    handleOpenReset();
  }
  prevIsOpen.current = isOpen;

  const updateItem = (supplierId, productId, patch) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.supplierId !== supplierId
          ? g
          : {
              ...g,
              items: g.items.map((it) => (it.productId !== productId ? it : { ...it, ...patch })),
            }
      )
    );
  };

  const toggleSelectAllForSupplier = (supplierId, checked) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.supplierId !== supplierId ? g : { ...g, items: g.items.map((it) => ({ ...it, checked })) }
      )
    );
  };

  const totals = useMemo(() => {
    return groups.map((g) => {
      const checkedItems = g.items.filter((it) => it.checked && it.quantity > 0);
      const totalPrice = checkedItems.reduce((sum, it) => sum + it.quantity * it.unitCost, 0);
      return { supplierId: g.supplierId, checkedCount: checkedItems.length, totalPrice };
    });
  }, [groups]);

  const hasAnySelection = totals.some((t) => t.checkedCount > 0);

  const handleSave = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const eligibleGroups = groups.filter((g) => g.items.some((it) => it.checked && it.quantity > 0));

      if (eligibleGroups.length === 0) {
        throw new Error('Select at least one product to include in the purchase order.');
      }

      for (const group of eligibleGroups) {
        const items = group.items
          .filter((it) => it.checked && it.quantity > 0)
          .map((it) => ({ productId: it.productId, quantity: Number(it.quantity), unitCost: Number(it.unitCost) }));

        const res = await fetch(`${API_BASE_URL}/purchase-orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ supplierId: group.supplierId, items, terms, remarks, preparedBy }),
        });

        if (res.status === 401) {
          logout();
          navigate('/', { replace: true });
          throw new Error('Your session is no longer valid. Please log in again.');
        }

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to create purchase order for ${group.supplierName}`);
        }

        const purchaseOrder = await res.json();
        await downloadPurchaseOrderFile(purchaseOrder);
      }

      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full border border-slate-100 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 shrink-0">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-600" />
            Create Purchase Order — Low Stock Items (below {LOW_STOCK_THRESHOLD})
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">
              {error}
            </div>
          )}

          {groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 text-sm gap-2">
              <PackageSearch className="w-8 h-8" />
              <p>No products are currently below the {LOW_STOCK_THRESHOLD}-unit reorder threshold.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Terms</label>
                  <input
                    type="text"
                    value={terms}
                    onChange={(e) => setTerms(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-600 mb-1">Prepared By</label>
                  <input
                    type="text"
                    value={preparedBy}
                    onChange={(e) => setPreparedBy(e.target.value)}
                    placeholder="Name of the person preparing this PO"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs"
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

              {groups.map((group) => {
                const groupTotal = totals.find((t) => t.supplierId === group.supplierId);
                const allChecked = group.items.every((it) => it.checked);

                return (
                  <div key={group.supplierId} className="border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="flex items-center justify-between bg-slate-50 px-4 py-2.5 border-b border-slate-200">
                      <div>
                        <p className="text-xs font-black text-slate-800 uppercase tracking-wide">
                          {group.supplierName}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {groupTotal.checkedCount} item(s) selected — Est. Total ₱{groupTotal.totalPrice.toFixed(2)}
                        </p>
                      </div>
                      <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          onChange={(e) => toggleSelectAllForSupplier(group.supplierId, e.target.checked)}
                        />
                        Select All
                      </label>
                    </div>

                    <table className="w-full text-left text-xs">
                      <thead className="bg-white text-slate-500 font-bold uppercase text-[10px] border-b border-slate-100">
                        <tr>
                          <th className="p-2 w-8"></th>
                          <th className="p-2">Product</th>
                          <th className="p-2 text-center">Stock</th>
                          <th className="p-2 text-center w-24">Qty</th>
                          <th className="p-2 text-center w-20">Unit</th>
                          <th className="p-2 text-center w-28">Unit Price</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {group.items.map((item) => (
                          <tr key={item.productId} className={!item.checked ? 'opacity-40' : ''}>
                            <td className="p-2">
                              <input
                                type="checkbox"
                                checked={item.checked}
                                onChange={(e) =>
                                  updateItem(group.supplierId, item.productId, { checked: e.target.checked })
                                }
                              />
                            </td>
                            <td className="p-2">
                              <p className="font-semibold text-slate-800">{item.name}</p>
                              <p className="text-[10px] text-slate-400 font-mono">{item.barcode}</p>
                            </td>
                            <td className="p-2 text-center text-rose-600 font-bold">{item.stock}</td>
                            <td className="p-2">
                              <input
                                type="number"
                                min="1"
                                value={item.quantity}
                                onChange={(e) =>
                                  updateItem(group.supplierId, item.productId, {
                                    quantity: parseInt(e.target.value, 10) || 0,
                                  })
                                }
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-center text-xs"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                value={item.unit}
                                onChange={(e) => updateItem(group.supplierId, item.productId, { unit: e.target.value })}
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-center text-xs"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.unitCost}
                                onChange={(e) =>
                                  updateItem(group.supplierId, item.productId, {
                                    unitCost: parseFloat(e.target.value) || 0,
                                  })
                                }
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-center text-xs"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {groups.length > 0 && (
          <div className="p-5 border-t border-slate-100 flex justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-200 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSubmitting || !hasAnySelection}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSubmitting ? 'Saving & Generating...' : 'Save & Download Purchase Order(s)'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
