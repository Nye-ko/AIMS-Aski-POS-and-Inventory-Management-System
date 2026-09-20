import { useEffect, useState } from 'react';
import { History, Loader2, Inbox } from 'lucide-react';
import { apiFetch } from '../../auth/apiFetch';

const API_BASE_URL = 'http://localhost:5000/api';
const PAGE_SIZE = 50;

const ACTION_LABELS = {
  USER_CREATED: 'Account created',
  USER_ROLE_CHANGED: 'Role changed',
  USER_ACTIVATED: 'Account activated',
  USER_DEACTIVATED: 'Account deactivated',
  USER_PIN_SET: 'Approval PIN set',
  USER_PIN_CLEARED: 'Approval PIN cleared',
  USER_PASSWORD_RESET: 'Password reset',
};

const describe = (row) => {
  const d = row.details || {};
  if (row.action === 'USER_ROLE_CHANGED') return `${d.from} → ${d.to}`;
  if (row.action === 'USER_CREATED') return d.role ? `as ${d.role}` : '';
  return '';
};

// Admin-only activity feed of user-management actions. Rendered inside User Management.
export default function AuditLogPanel({ refreshKey = 0 }) {
  const [rows, setRows] = useState([]);
  const [action, setAction] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);

  const fetchPage = async (before, actionFilter) => {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (before) query.set('before', String(before));
    if (actionFilter) query.set('action', actionFilter);
    const res = await apiFetch(`${API_BASE_URL}/audit-log?${query}`);
    if (!res.ok) throw new Error('Failed to load activity log.');
    return res.json();
  };

  useEffect(() => {
    let cancelled = false;
    fetchPage(null, action)
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setHasMore(data.length === PAGE_SIZE);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [action, refreshKey]);

  const handleFilterChange = (value) => {
    setIsLoading(true);
    setAction(value);
  };

  const loadOlder = async () => {
    setIsLoading(true);
    try {
      const data = await fetchPage(rows[rows.length - 1].id, action);
      setRows((prev) => [...prev, ...data]);
      setHasMore(data.length === PAGE_SIZE);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200/80 rounded-3xl shadow-sm p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-slate-100 text-slate-600">
            <History className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Activity Log</h3>
        </div>
        <select
          value={action}
          onChange={(e) => handleFilterChange(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700"
        >
          <option value="">All actions</option>
          {Object.entries(ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {error && <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">{error}</div>}

      <div className="overflow-x-auto border border-slate-200 rounded-2xl">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600 font-extrabold uppercase text-[10px] tracking-wider border-b-2 border-slate-200">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Details</th>
              <th className="px-4 py-3">By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!isLoading && !error && rows.length === 0 && (
              <tr>
                <td colSpan="5" className="px-4 py-8 text-center text-slate-400">
                  <div className="flex flex-col items-center gap-2">
                    <Inbox className="w-5 h-5" />
                    <span>No activity recorded yet.</span>
                  </div>
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{new Date(row.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3 font-semibold text-slate-700">{ACTION_LABELS[row.action] || row.action}</td>
                <td className="px-4 py-3 text-slate-700">{row.targetUsername || '—'}</td>
                <td className="px-4 py-3 text-slate-500">{describe(row)}</td>
                <td className="px-4 py-3 text-slate-500">{row.actorUsername}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-2 text-slate-400 text-xs">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading activity...
        </div>
      )}
      {!isLoading && hasMore && (
        <div className="flex justify-center">
          <button type="button" onClick={loadOlder} className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 transition cursor-pointer">
            Load older
          </button>
        </div>
      )}
    </div>
  );
}
