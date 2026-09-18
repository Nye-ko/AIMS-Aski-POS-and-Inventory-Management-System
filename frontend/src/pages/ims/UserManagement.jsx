import { useState, useEffect, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Users,
  UserPlus,
  Eye,
  EyeOff,
  Loader2,
  Inbox,
  KeyRound,
  ShieldCheck,
  Power,
  RotateCcw,
  Copy,
  Check,
  X,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';

const API_BASE_URL = 'http://localhost:5000/api';

const ROLE_OPTIONS = [
  { value: 'CASHIER', label: 'Cashier', hint: 'Front-of-house POS access' },
  { value: 'SUPERVISOR', label: 'Supervisor', hint: 'Discounts, overrides & report verification access' },
  { value: 'INVENTORY', label: 'Inventory Staff', hint: 'Stock management, POs & receiving reports access' },
];

const ROLE_BADGE = {
  CASHIER: 'bg-blue-500/10 text-blue-700 border border-blue-300/40',
  SUPERVISOR: 'bg-purple-500/10 text-purple-700 border border-purple-300/40',
  INVENTORY: 'bg-emerald-500/10 text-emerald-700 border border-emerald-300/40',
  ADMIN: 'bg-indigo-500/10 text-indigo-700 border border-indigo-300/40',
  ACCOUNTING: 'bg-amber-500/10 text-amber-700 border border-amber-300/40',
};

const ROLE_LABEL = {
  CASHIER: 'Cashier',
  SUPERVISOR: 'Supervisor',
  INVENTORY: 'Inventory Staff',
  ADMIN: 'Admin',
  ACCOUNTING: 'Accounting',
};

const EMPTY_FORM = { fullName: '', role: 'CASHIER', username: '', password: '', confirmPassword: '' };

function passwordStrength(password) {
  if (!password) return { score: 0, label: '', color: '' };
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  const levels = [
    { label: 'Too weak', color: 'bg-rose-500' },
    { label: 'Weak', color: 'bg-rose-500' },
    { label: 'Fair', color: 'bg-amber-500' },
    { label: 'Good', color: 'bg-blue-500' },
    { label: 'Strong', color: 'bg-emerald-500' },
  ];
  return { score, ...levels[score] };
}

export default function UserManagement() {
  const { user: currentUser, token, role, isAdminAuthenticated, logout } = useAuth();

  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [formError, setFormError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [editingRoleId, setEditingRoleId] = useState(null);
  const [roleDraft, setRoleDraft] = useState('');
  const [rowBusyId, setRowBusyId] = useState(null);
  const [rowError, setRowError] = useState(null);
  const [resetResult, setResetResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const authHeaders = useMemo(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token]
  );

  const handleAuthFailure = (status) => {
    if (status === 401) {
      logout();
      return true;
    }
    return false;
  };

  const fetchUsers = async () => {
    setIsLoading(true);
    setListError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/users`, { headers: authHeaders });
      if (handleAuthFailure(res.status)) return;
      const body = await res.json().catch(() => ([]));
      if (!res.ok) throw new Error(body.error || 'Failed to load users.');
      setUsers(body);
    } catch (err) {
      setListError(err.message || 'Failed to load users.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (role === 'ADMIN') {
      fetchUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  if (role !== 'ADMIN') {
    return <Navigate to="/adminDashboard" replace />;
  }

  // Direct URL navigation (bypassing the sidebar's admin password prompt) still
  // requires a verified isAdminAuthenticated flag for this browser session.
  if (!isAdminAuthenticated) {
    return <Navigate to="/adminDashboard" replace />;
  }

  const strength = passwordStrength(form.password);
  const passwordsMatch = form.confirmPassword.length === 0 || form.password === form.confirmPassword;

  const handleFieldChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleReset = () => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowPassword(false);
    setShowConfirmPassword(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);

    if (!form.fullName.trim() || !form.username.trim()) {
      setFormError('Full name and username are required.');
      return;
    }
    if (form.password.length < 6) {
      setFormError('Password must be at least 6 characters.');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/users`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          username: form.username.trim(),
          password: form.password,
          role: form.role,
        }),
      });
      if (handleAuthFailure(res.status)) return;
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to create user account.');

      setUsers((prev) => [body, ...prev]);
      handleReset();
    } catch (err) {
      setFormError(err.message || 'Failed to create user account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const startEditRole = (u) => {
    setRowError(null);
    setEditingRoleId(u.id);
    setRoleDraft(u.role);
  };

  const cancelEditRole = () => {
    setEditingRoleId(null);
    setRoleDraft('');
  };

  const saveRole = async (u) => {
    if (roleDraft === u.role) {
      cancelEditRole();
      return;
    }
    setRowBusyId(u.id);
    setRowError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/users/${u.id}/role`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ role: roleDraft }),
      });
      if (handleAuthFailure(res.status)) return;
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to update role.');
      setUsers((prev) => prev.map((row) => (row.id === u.id ? body : row)));
      cancelEditRole();
    } catch (err) {
      setRowError(err.message || 'Failed to update role.');
    } finally {
      setRowBusyId(null);
    }
  };

  const toggleStatus = async (u) => {
    setRowBusyId(u.id);
    setRowError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/users/${u.id}/status`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ isActive: !u.isActive }),
      });
      if (handleAuthFailure(res.status)) return;
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to update status.');
      setUsers((prev) => prev.map((row) => (row.id === u.id ? body : row)));
    } catch (err) {
      setRowError(err.message || 'Failed to update status.');
    } finally {
      setRowBusyId(null);
    }
  };

  const resetPassword = async (u) => {
    setRowBusyId(u.id);
    setRowError(null);
    setResetResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/users/${u.id}/reset-password`, {
        method: 'POST',
        headers: authHeaders,
      });
      if (handleAuthFailure(res.status)) return;
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to reset password.');
      setResetResult({ username: u.username, tempPassword: body.tempPassword });
    } catch (err) {
      setRowError(err.message || 'Failed to reset password.');
    } finally {
      setRowBusyId(null);
    }
  };

  const copyTempPassword = async () => {
    if (!resetResult) return;
    try {
      await navigator.clipboard.writeText(resetResult.tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable — non-fatal */
    }
  };

  return (
    <div className="space-y-6">
      {/* ===== HEADER ===== */}
      <header className="relative z-30 flex items-center justify-between bg-gradient-to-r from-white via-white/90 to-blue-200/60 backdrop-blur-xl border border-white/80 rounded-3xl px-8 py-4 shadow-xl shadow-blue-500/10">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/30">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-blue-600">AMPC POS</p>
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">USER ACCOUNT MANAGEMENT</h2>
          </div>
        </div>
      </header>

      {resetResult && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
          <p className="text-xs font-semibold text-emerald-800">
            Temporary password for <span className="font-black">{resetResult.username}</span>:{' '}
            <span className="font-mono text-sm bg-white border border-emerald-200 rounded-lg px-2 py-0.5">
              {resetResult.tempPassword}
            </span>{' '}
            — share this securely. It won't be shown again.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={copyTempPassword}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-emerald-300 text-emerald-700 font-bold text-xs rounded-xl hover:bg-emerald-100 transition cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={() => setResetResult(null)}
              className="p-1.5 text-emerald-700 hover:bg-emerald-100 rounded-full transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ===== CREATE FORM ===== */}
        <div className="lg:col-span-1 relative overflow-hidden bg-white border border-slate-200/80 rounded-3xl shadow-sm h-fit">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-sm shadow-blue-500/30">
              <UserPlus className="w-4 h-4 text-white" />
            </div>
            <h3 className="text-sm font-black text-slate-800 tracking-tight">Create User Account</h3>
          </div>

          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {formError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">
                {formError}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">Full Name</label>
              <input
                type="text"
                value={form.fullName}
                onChange={handleFieldChange('fullName')}
                placeholder="e.g., Juan Dela Cruz"
                className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">Role</label>
              <select
                value={form.role}
                onChange={handleFieldChange('role')}
                className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                {ROLE_OPTIONS.find((r) => r.value === form.role)?.hint}
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">Username</label>
              <input
                type="text"
                value={form.username}
                onChange={handleFieldChange('username')}
                placeholder="e.g., cashier_juan"
                className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={handleFieldChange('password')}
                  placeholder="At least 6 characters"
                  className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 pr-10 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {form.password && (
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${strength.color} transition-all duration-300`}
                      style={{ width: `${(strength.score / 4) * 100}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-bold text-slate-500">{strength.label}</span>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">Confirm Password</label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={form.confirmPassword}
                  onChange={handleFieldChange('confirmPassword')}
                  placeholder="Re-enter password"
                  className={`w-full rounded-xl bg-slate-50 border px-3.5 py-2.5 pr-10 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 transition-all ${
                    passwordsMatch ? 'border-slate-200 focus:ring-blue-500' : 'border-rose-300 focus:ring-rose-500'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {!passwordsMatch && (
                <p className="mt-1 text-[11px] font-semibold text-rose-600">Passwords do not match.</p>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 flex items-center justify-center gap-2 bg-[#0B132B] hover:bg-slate-800 text-white rounded-xl px-4 py-2.5 font-bold text-xs shadow-lg shadow-slate-900/20 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {isSubmitting ? 'Creating...' : 'Create User Account'}
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="flex items-center gap-1.5 px-3.5 py-2.5 bg-white border border-slate-200 text-slate-600 font-bold text-xs rounded-xl hover:bg-slate-50 transition cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Clear
              </button>
            </div>
          </form>
        </div>

        {/* ===== USERS TABLE ===== */}
        <div className="lg:col-span-2 relative overflow-hidden bg-white border border-slate-200/80 rounded-3xl shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-sm shadow-blue-500/30">
                <ShieldCheck className="w-4 h-4 text-white" />
              </div>
              <h3 className="text-sm font-black text-slate-800 tracking-tight">System User Accounts</h3>
              <span className="text-[11px] text-blue-700 font-bold bg-blue-500/10 border border-blue-200/50 px-2.5 py-1 rounded-full">
                {users.length}
              </span>
            </div>
          </div>

          {rowError && (
            <div className="mx-5 mt-4 p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">
              {rowError}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-extrabold uppercase text-[10px] tracking-wider border-b-2 border-slate-200">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Username</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created Date</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan="6" className="px-4 py-10 text-center text-slate-400">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading users...
                      </div>
                    </td>
                  </tr>
                ) : listError ? (
                  <tr>
                    <td colSpan="6" className="px-4 py-8 text-center text-rose-600 font-semibold">{listError}</td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="px-4 py-10 text-center text-slate-400">
                      <div className="flex flex-col items-center gap-2">
                        <Inbox className="w-6 h-6" />
                        <span>No user accounts yet.</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  users.map((u) => {
                    const isSelf = currentUser?.id === u.id;
                    const isBusy = rowBusyId === u.id;
                    return (
                      <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 font-bold text-slate-800">{u.fullName || '—'}</td>
                        <td className="px-4 py-3 text-slate-600 font-medium">{u.username}</td>
                        <td className="px-4 py-3">
                          {editingRoleId === u.id ? (
                            <div className="flex items-center gap-1.5">
                              <select
                                value={roleDraft}
                                onChange={(e) => setRoleDraft(e.target.value)}
                                className="rounded-lg bg-slate-50 border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                              >
                                {ROLE_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                              <button
                                onClick={() => saveRole(u)}
                                disabled={isBusy}
                                className="p-1 text-emerald-600 hover:bg-emerald-50 rounded-lg transition cursor-pointer disabled:opacity-50"
                              >
                                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                onClick={cancelEditRole}
                                className="p-1 text-slate-400 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold ${ROLE_BADGE[u.role] || 'bg-slate-500/10 text-slate-700 border border-slate-300/40'}`}>
                              {ROLE_LABEL[u.role] || u.role}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                            u.isActive
                              ? 'bg-emerald-500/10 text-emerald-700 border border-emerald-300/40'
                              : 'bg-rose-500/10 text-rose-700 border border-rose-300/40'
                          }`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-current" />
                            {u.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500 font-medium">
                          {new Date(u.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <button
                              title="Reset Password"
                              onClick={() => resetPassword(u)}
                              disabled={isBusy}
                              className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition cursor-pointer disabled:opacity-50"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                            </button>
                            <button
                              title="Edit Role"
                              onClick={() => startEditRole(u)}
                              disabled={isBusy || editingRoleId === u.id}
                              className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition cursor-pointer disabled:opacity-50"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                            </button>
                            <button
                              title={isSelf ? "You can't deactivate your own account" : u.isActive ? 'Deactivate' : 'Activate'}
                              onClick={() => toggleStatus(u)}
                              disabled={isBusy || isSelf}
                              className={`p-1.5 rounded-lg transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                                u.isActive ? 'text-slate-500 hover:text-rose-700 hover:bg-rose-50' : 'text-slate-500 hover:text-emerald-700 hover:bg-emerald-50'
                              }`}
                            >
                              {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
