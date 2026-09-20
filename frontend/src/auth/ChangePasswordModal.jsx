import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, KeyRound, Eye, EyeOff, Loader2, CheckCircle2 } from 'lucide-react';
import { apiFetch } from './apiFetch';

const API_BASE_URL = 'http://localhost:5000/api';
const MIN_LENGTH = 6;

const fieldClass =
  'w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 pr-10 text-sm font-medium text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all';

function PasswordField({ label, value, onChange, autoFocus = false, autoComplete }) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label className="block text-xs font-bold text-slate-600 mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          className={fieldClass}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

// Mount only while open. Any signed-in user can change their own password here.
export default function ChangePasswordModal({ onClose }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!current) return setError('Enter your current password.');
    if (next.length < MIN_LENGTH) return setError(`New password must be at least ${MIN_LENGTH} characters.`);
    if (next !== confirm) return setError('The new passwords do not match.');
    if (next === current) return setError('New password must be different from the current one.');

    setIsSaving(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to change password.');
      }
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <form onSubmit={handleSubmit} className="font-sans bg-white rounded-2xl shadow-2xl max-w-sm w-full border border-slate-200/80 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/30">
              <KeyRound className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-black text-slate-800 tracking-tight">Change Password</h3>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-full transition-colors cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {done ? (
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-2 text-emerald-700 text-sm font-bold">
              <CheckCircle2 className="w-5 h-5" /> Password updated.
            </div>
            <p className="text-xs text-slate-500">Use your new password the next time you sign in.</p>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="px-5 py-2 bg-slate-900 text-white font-bold text-xs rounded-xl cursor-pointer">
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="p-6 space-y-4">
              {error && <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">{error}</div>}
              <PasswordField label="Current password" value={current} onChange={setCurrent} autoFocus autoComplete="current-password" />
              <PasswordField label="New password" value={next} onChange={setNext} autoComplete="new-password" />
              <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 transition cursor-pointer">
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex items-center gap-2 px-5 py-2 bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-xs rounded-xl shadow-md transition disabled:opacity-50 cursor-pointer"
              >
                {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {isSaving ? 'Saving...' : 'Update Password'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>,
    document.body
  );
}
