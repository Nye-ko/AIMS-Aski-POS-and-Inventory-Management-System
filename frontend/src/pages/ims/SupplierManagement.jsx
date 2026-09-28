import { useState } from 'react';
import { Truck, Plus, Pencil, Loader2, Inbox, X, Mail, Phone, MapPin, Clock, Package } from 'lucide-react';
import { apiFetch } from '../../auth/apiFetch';
import { API_BASE_URL } from '../../config';

const throwApiError = async (response) => {
  const body = await response.json().catch(() => ({}));
  throw new Error(body.error || `HTTP error status ${response.status}`);
};

const EMPTY_FORM = { name: '', contactPerson: '', email: '', phone: '', address: '', leadTimeDays: '7' };

const toFormState = (s) => ({
  name: s.name || '',
  contactPerson: s.contactPerson || '',
  email: s.email || '',
  phone: s.phone || '',
  address: s.address || '',
  leadTimeDays: String(s.leadTimeDays ?? 7),
});

// Fields shared by both create and edit: null/'' clears an optional field, leadTimeDays is validated
// server-side too (1-90 days) but checked here first so the form can show an inline error.
const buildPayload = (form) => {
  const leadTimeDays = Number(form.leadTimeDays);
  if (!Number.isInteger(leadTimeDays) || leadTimeDays < 1 || leadTimeDays > 90) {
    throw new Error('Lead time must be a whole number of days from 1 to 90.');
  }
  if (!form.name.trim()) throw new Error('Supplier name is required.');
  return {
    name: form.name.trim(),
    contactPerson: form.contactPerson.trim() || null,
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    address: form.address.trim() || null,
    leadTimeDays,
  };
};

export default function SupplierManagement({ suppliers, isLoading, onSuppliersChanged }) {
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [createError, setCreateError] = useState(null);
  const [isCreating, setIsCreating] = useState(false);

  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editError, setEditError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const openCreate = () => {
    setCreateForm(EMPTY_FORM);
    setCreateError(null);
    setShowCreate(true);
  };
  const closeCreate = () => setShowCreate(false);

  const submitCreate = async (e) => {
    e.preventDefault();
    setCreateError(null);
    let payload;
    try {
      payload = buildPayload(createForm);
    } catch (err) {
      setCreateError(err.message);
      return;
    }
    setIsCreating(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/suppliers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) await throwApiError(res);
      await onSuppliersChanged();
      setShowCreate(false);
    } catch (err) {
      setCreateError(err.message || 'Failed to create supplier.');
    } finally {
      setIsCreating(false);
    }
  };

  const openEdit = (supplier) => {
    setEditTarget(supplier);
    setEditForm(toFormState(supplier));
    setEditError(null);
  };
  const closeEdit = () => setEditTarget(null);

  const submitEdit = async (e) => {
    e.preventDefault();
    setEditError(null);
    let payload;
    try {
      payload = buildPayload(editForm);
    } catch (err) {
      setEditError(err.message);
      return;
    }
    setIsSaving(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/suppliers/${editTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) await throwApiError(res);
      await onSuppliersChanged();
      setEditTarget(null);
    } catch (err) {
      setEditError(err.message || 'Failed to update supplier.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden bg-white border border-slate-200/80 rounded-3xl shadow-sm">
        <div className="px-4 py-3 sm:px-5 sm:py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-sm shadow-blue-500/30 shrink-0">
              <Truck className="w-4 h-4 text-white" />
            </div>
            <h3 className="text-xs sm:text-sm font-black text-slate-800 tracking-tight truncate">Suppliers</h3>
            <span className="text-[11px] text-blue-700 font-bold bg-blue-500/10 border border-blue-200/50 px-2.5 py-1 rounded-full shrink-0">
              {suppliers.length}
            </span>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-2 sm:px-3.5 sm:py-2.5 bg-[#0B132B] hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-md shadow-slate-900/20 transition cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Add Supplier</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px] sm:text-xs">
            <thead className="bg-slate-50 text-slate-600 font-extrabold uppercase text-[10px] tracking-wider border-b-2 border-slate-200">
              <tr>
                <th className="px-3 py-2 sm:px-4 sm:py-3">Name</th>
                <th className="px-3 py-2 sm:px-4 sm:py-3">Contact</th>
                <th className="px-3 py-2 sm:px-4 sm:py-3">Lead Time</th>
                <th className="px-3 py-2 sm:px-4 sm:py-3">Products</th>
                <th className="px-3 py-2 sm:px-4 sm:py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan="5" className="px-4 py-10 text-center text-slate-400">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading suppliers...
                    </div>
                  </td>
                </tr>
              ) : suppliers.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-4 py-10 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <Inbox className="w-6 h-6" />
                      <span>No suppliers yet.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                suppliers.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2 sm:px-4 sm:py-3 font-bold text-slate-800">
                      {s.name}
                      {s.address && <div className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-slate-400"><MapPin className="w-3 h-3 shrink-0" /><span className="truncate max-w-[220px]">{s.address}</span></div>}
                    </td>
                    <td className="px-3 py-2 sm:px-4 sm:py-3 text-slate-600">
                      {s.contactPerson && <div className="font-semibold text-slate-700">{s.contactPerson}</div>}
                      {s.email && <div className="flex items-center gap-1 text-[10px] text-slate-500"><Mail className="w-3 h-3 shrink-0" />{s.email}</div>}
                      {s.phone && <div className="flex items-center gap-1 text-[10px] text-slate-500"><Phone className="w-3 h-3 shrink-0" />{s.phone}</div>}
                      {!s.contactPerson && !s.email && !s.phone && <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-2 sm:px-4 sm:py-3">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-indigo-500/10 text-indigo-700 border border-indigo-300/40">
                        <Clock className="w-3 h-3" />
                        {s.leadTimeDays}d
                      </span>
                    </td>
                    <td className="px-3 py-2 sm:px-4 sm:py-3 text-slate-500 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <Package className="w-3 h-3" />
                        {s.productCount}
                      </span>
                    </td>
                    <td className="px-3 py-2 sm:px-4 sm:py-3">
                      <button
                        title="Edit Supplier"
                        onClick={() => openEdit(s)}
                        className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(showCreate || editTarget) && (
        <SupplierFormModal
          title={showCreate ? 'Add Supplier' : `Edit ${editTarget.name}`}
          form={showCreate ? createForm : editForm}
          setForm={showCreate ? setCreateForm : setEditForm}
          error={showCreate ? createError : editError}
          isSaving={showCreate ? isCreating : isSaving}
          onSubmit={showCreate ? submitCreate : submitEdit}
          onClose={showCreate ? closeCreate : closeEdit}
        />
      )}
    </div>
  );
}

function SupplierFormModal({ title, form, setForm, error, isSaving, onSubmit, onClose }) {
  const field = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 overflow-hidden">
        <div className="flex items-start justify-between gap-3 p-6 pb-3">
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="px-6 pb-6 space-y-3">
          {error && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">
              {error}
            </div>
          )}

          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">Supplier Name</label>
            <input
              type="text"
              value={form.name}
              onChange={field('name')}
              placeholder="e.g., Alpha Distributing Co."
              className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">Contact Person</label>
            <input
              type="text"
              value={form.contactPerson}
              onChange={field('contactPerson')}
              placeholder="e.g., Juan Dela Cruz"
              className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1.5">Email</label>
              <input
                type="text"
                value={form.email}
                onChange={field('email')}
                placeholder="name@supplier.com"
                className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1.5">Phone</label>
              <input
                type="text"
                value={form.phone}
                onChange={field('phone')}
                placeholder="0917 123 4567"
                className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">Address</label>
            <input
              type="text"
              value={form.address}
              onChange={field('address')}
              placeholder="Street, Barangay, City"
              className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">Lead Time (days)</label>
            <input
              type="number"
              min="1"
              max="90"
              value={form.leadTimeDays}
              onChange={field('leadTimeDays')}
              className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all"
            />
            <p className="mt-1 text-[11px] text-slate-500">Days from placing an order to receiving it — drives every one of this supplier's products' reorder points.</p>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-full transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-[#0B132B] text-white text-xs font-bold rounded-full transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
