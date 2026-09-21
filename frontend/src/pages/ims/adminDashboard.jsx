import React, { useState, useEffect } from 'react';
import { Home, Bell, Banknote, AlertTriangle, Mail } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { io } from 'socket.io-client';
import NotificationPanel from './NotificationPanel';
import { useAlertNotifications } from '../../hooks/useAlertNotifications';
import { apiFetch, getAuthToken } from '../../auth/apiFetch';

const SOCKET_SERVER_URL = 'http://localhost:5000';

export default function Dashboard() {
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const notif = useAlertNotifications();

  //dashboard data
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [isLoadingTxns, setIsLoadingTxns] = useState(true);

  const [todayRevenue, setTodayRevenue] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);

  const [dailySalesData, setDailySalesData] = useState([]);

  const [expiryWatchList, setExpiryWatchList] = useState([])

  // --- AI Demand Forecast (live) ---
  const [forecast, setForecast] = useState(null); // { kpis, revenueTrajectory }
  const [forecastError, setForecastError] = useState(null);

  // --- SMTP alert banner state ---
  const [alertBanner, setAlertBanner] = useState(null); // { type: 'success'|'error'|'info', text: string }
  const [sendingLowStock, setSendingLowStock] = useState(false);
  const [sendingExpiry, setSendingExpiry] = useState(false);
  const [sendingForecast, setSendingForecast] = useState(false);

  const flashAlert = (type, text) => {
    setAlertBanner({ type, text });
    window.clearTimeout(flashAlert._t);
    flashAlert._t = window.setTimeout(() => setAlertBanner(null), 4000);
  };

  const sendLowStockAlert = async () => {
    setSendingLowStock(true);
    try {
      const res = await apiFetch(`${SOCKET_SERVER_URL}/api/alerts/low-stock/send-now`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      if (body.count === 0) flashAlert('info', 'No low-stock items right now — nothing to email.');
      else flashAlert('success', `Low-stock alert sent for ${body.count} item${body.count === 1 ? '' : 's'}.`);
    } catch (err) {
      flashAlert('error', err.message || 'Failed to send low-stock alert.');
    } finally {
      setSendingLowStock(false);
    }
  };

  const sendExpiryAlert = async () => {
    setSendingExpiry(true);
    try {
      const res = await apiFetch(`${SOCKET_SERVER_URL}/api/alerts/expiry/send-now`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      if (body.count === 0) flashAlert('info', 'No products in the expiry window — nothing to email.');
      else flashAlert('success', `Expiry alert sent for ${body.count} item${body.count === 1 ? '' : 's'}.`);
    } catch (err) {
      flashAlert('error', err.message || 'Failed to send expiry alert.');
    } finally {
      setSendingExpiry(false);
    }
  };

  const sendForecastEmail = async () => {
    setSendingForecast(true);
    try {
      const res = await apiFetch(`${SOCKET_SERVER_URL}/api/alerts/forecast/send-now`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      if (body.skipped) flashAlert('info', 'No forecast data to email right now.');
      else flashAlert('success', 'AI forecast summary emailed.');
    } catch (err) {
      flashAlert('error', err.message || 'Failed to send forecast email.');
    } finally {
      setSendingForecast(false);
    }
  };

  const fetchForecast = async () => {
    try {
      const res = await apiFetch(`${SOCKET_SERVER_URL}/api/forecast?days=30`);
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.message || `Forecast failed (${res.status})`);
      setForecast(body.data);
      setForecastError(null);
    } catch (err) {
      console.error('Forecast fetch failed:', err);
      setForecastError(err.message || 'Forecast unavailable');
      setForecast(null);
    }
  };

  useEffect(() => {
    // Initial REST fetch for dashboard data
    const fetchDashboardData = async () => {
      try {
        const summaryRes = await apiFetch(`${SOCKET_SERVER_URL}/api/dashboard/summary`);
        if (!summaryRes.ok) throw new Error(`Dashboard summary failed (${summaryRes.status})`);
        const summaryData = await summaryRes.json();

        setRecentTransactions(summaryData.recentTransactions || []);
        setTodayRevenue(Number(summaryData.todayRevenue));
        setLowStockCount(Number(summaryData.lowStockCount));
        setDailySalesData(summaryData.dailySalesTrend);
        setExpiryWatchList(summaryData.expiryWatchList);

      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setIsLoadingTxns(false);
      }
    };

    fetchDashboardData();
    fetchForecast();

    //Connect to Socket.io server
    const socket = io(SOCKET_SERVER_URL, { auth: { token: getAuthToken() } });

    socket.on('transaction_created', (newTx) => {
      setRecentTransactions((prev) => [newTx, ...prev.slice(0, 4)]);
      setTodayRevenue((prev) => prev + Number(newTx.totalAmount));

      apiFetch(`${SOCKET_SERVER_URL}/api/dashboard/summary`)
        .then((res) => res.json())
        .then((data) => setLowStockCount(data.lowStockCount))
        .catch(console.error);

      // A checkout can push a product's stock across its minStock line.
      notif.refresh();

      // Every checkout invalidates the forecast — re-fetch.
      fetchForecast();
    });

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {alertBanner && (
        <div
          role="alert"
          className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl border shadow-xl backdrop-blur-md text-sm font-bold ${
            alertBanner.type === 'success'
              ? 'bg-emerald-100/95 border-emerald-300 text-emerald-800'
              : alertBanner.type === 'error'
                ? 'bg-rose-100/95 border-rose-300 text-rose-800'
                : 'bg-sky-100/95 border-sky-300 text-sky-900'
          }`}
        >
          {alertBanner.text}
        </div>
      )}

      {/* ===== HEADER ====== */}
      <header className="relative z-30 flex items-center justify-between bg-gradient-to-r from-white via-white/90 to-blue-200/60 backdrop-blur-xl border border-white/80 rounded-3xl px-8 py-4 shadow-xl shadow-blue-500/10">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/30">
            <Home className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-blue-600">AMPC</p>
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">DASHBOARD</h2>
          </div>
        </div>

        <div className="relative">
          <button
            onClick={() => setIsNotifOpen(!isNotifOpen)}
            className="relative p-3 rounded-2xl bg-white border border-slate-200/60 text-slate-700 hover:bg-slate-50 transition shadow-sm"
          >
            <Bell className="w-5 h-5 text-slate-700" />
            {notif.unreadCount > 0 && (
              <span className="absolute top-2.5 right-2.5 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-white animate-pulse" />
            )}
          </button>

          <NotificationPanel
            isOpen={isNotifOpen}
            onClose={() => setIsNotifOpen(false)}
            notifications={notif.notifications}
            loading={notif.loading}
            error={notif.error}
            unreadCount={notif.unreadCount}
            markAllRead={notif.markAllRead}
          />
        </div>
      </header>

      {/* MAIN GRID SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0 mt-6">
        {/* LEFT COLUMN */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {/* TOP METRICS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-white/80 via-blue-100/30 to-indigo-300/40 backdrop-blur-xl border border-white/80 p-5 shadow-xl shadow-blue-500/10 hover:shadow-2xl hover:scale-[1.02] hover:-translate-y-1 transition-all duration-300">
              <div className="absolute -top-10 -left-10 w-32 h-32 bg-sky-300/40 rounded-full blur-2xl group-hover:scale-125 transition-transform duration-500 pointer-events-none" />
              <div className="flex items-center justify-between mb-3 relative z-10">
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Total Revenue Today</span>
                <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-sky-400 text-white shadow-md shadow-blue-500/30">
                  <Banknote className="w-4 h-4" />
                </div>
              </div>
              <h3 className="text-2xl font-black text-slate-800 tracking-tight relative z-10">
                PHP {todayRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h3>
            </div>

            <div className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-white/80 via-blue-100/30 to-indigo-300/40 backdrop-blur-xl border border-white/80 p-5 shadow-xl shadow-blue-500/10 hover:shadow-2xl hover:scale-[1.02] hover:-translate-y-1 transition-all duration-300">
              <div className="absolute -top-10 -left-10 w-32 h-32 bg-rose-300/30 rounded-full blur-2xl group-hover:scale-125 transition-transform duration-500 pointer-events-none" />
              <div className="flex items-center justify-between mb-3 relative z-10">
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Low Stocks Alert</span>
                <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-amber-500 via-rose-500 to-rose-600 text-white shadow-md shadow-rose-500/30">
                  <AlertTriangle className="w-4 h-4" />
                </div>
              </div>
              <h3 className="text-2xl font-black text-rose-700 tracking-tight relative z-10">
                {lowStockCount} {lowStockCount === 1 ? 'Item' : 'Items'}
              </h3>
              <button
                type="button"
                onClick={sendLowStockAlert}
                disabled={sendingLowStock}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-slate-800/90 px-3 py-1 text-[11px] font-bold text-white shadow hover:bg-slate-900 disabled:opacity-60 relative z-10"
              >
                <Mail className="w-3 h-3" aria-hidden="true" />
                {sendingLowStock ? 'Sending…' : 'Email alert now'}
              </button>
            </div>
          </div>

          {/* DAILY SALES TREND CHART */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-tr from-white via-white/90 to-blue-200/60 backdrop-blur-xl border border-white/80 p-6 shadow-xl shadow-blue-500/10 hover:shadow-2xl hover:shadow-blue-500/15 transition-all duration-300 flex-1 flex flex-col justify-between min-h-[220px]">
            <div className="absolute top-0 left-0 w-64 h-64 bg-sky-300/40 rounded-full blur-3xl pointer-events-none" />
            <div className="flex items-center justify-between mb-4 relative z-10">
              <div>
                <h3 className="text-lg font-bold text-slate-800">Daily Sales Trend</h3>
                <p className="text-xs text-slate-500">Day-by-day overall revenue performance</p>
              </div>
            </div>

            {/* DAILY SALES TREND CHART BLOCK */}
            <div className="h-56 w-full relative z-10">
              {!dailySalesData || dailySalesData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-400">
                  No sales recorded for the last 30 days.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailySalesData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff80" vertical={false} />
                    <XAxis dataKey="day" stroke="#475569" fontSize={11} tickLine={false} />
                    <YAxis stroke="#475569" fontSize={11} tickLine={false} tickFormatter={(val) => `₱${val}`} />
                    <Tooltip
                      formatter={(value) => [`₱${Number(value).toLocaleString()}`, 'Sales']}
                      contentStyle={{
                        backgroundColor: 'rgba(255, 255, 255, 0.85)',
                        backdropFilter: 'blur(12px)',
                        borderRadius: '16px',
                        border: '1px solid rgba(255,255,255,0.8)',
                        boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="sales"
                      stroke="#2563eb"
                      strokeWidth={3}
                      fillOpacity={1}
                      fill="url(#salesGrad)"
                      dot={{ r: 4, fill: '#2563eb', stroke: '#ffffff', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* RECENT TRANSACTIONS TABLE */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-white via-white/90 to-blue-200/60 backdrop-blur-xl border border-white/80 p-6 shadow-xl shadow-blue-500/10 hover:shadow-2xl transition-all duration-300 flex flex-col">
            <div className="mb-3 flex items-center justify-between relative z-10">
              <div>
                <h3 className="text-lg font-bold text-slate-800">Recent Transactions</h3>
                <p className="text-xs text-slate-500">Latest completed point-of-sale entries</p>
              </div>
              {/* Live WebSocket Indicator */}
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200/60 px-3 py-1 rounded-full">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Live Feed</span>
              </div>
            </div>

            <div className="overflow-x-auto relative z-10">
              {isLoadingTxns ? (
                <p className="py-4 text-xs text-slate-400 font-medium text-center">Loading transactions...</p>
              ) : recentTransactions.length === 0 ? (
                <p className="py-4 text-xs text-slate-400 font-medium text-center">No transactions recorded yet.</p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-200/60 uppercase text-[10px] tracking-wider font-bold">
                      <th className="pb-2">Date / Time</th>
                      <th className="pb-2">Transaction No</th>
                      <th className="pb-2 text-center">Amount</th>
                      <th className="pb-2 text-right">Payment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/40 font-medium text-slate-700">
                    {recentTransactions.map((tx) => (
                      <tr key={tx.id || tx.transactionNo} className="hover:bg-white/50 transition-colors">
                        <td className="py-2.5 whitespace-nowrap">
                          {new Date(tx.createdAt).toLocaleDateString('en-GB')} {new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-2.5 font-mono text-slate-600 whitespace-nowrap">{tx.transactionNo}</td>
                        <td className="py-2.5 text-center font-bold text-slate-800 whitespace-nowrap">
                          PHP {Number(tx.totalAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold bg-blue-500/15 text-blue-700 border border-blue-300/50">
                            {tx.paymentMethod}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* AI DEMAND FORECAST CHART */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 backdrop-blur-xl border border-slate-700/60 p-6 shadow-2xl shadow-slate-900/40 transition-all duration-300 flex-1 flex flex-col justify-between min-h-[220px]">
            <div className="absolute top-0 right-0 w-48 h-48 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-blue-600/15 rounded-full blur-2xl pointer-events-none" />

            <div className="mb-3 relative z-10 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-white tracking-wide">AI Demand Forecast</h3>
                <p className="text-xs text-slate-400">
                  Projected revenue for the next 30 days
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                  </span>
                  Live
                </span>
                <button
                  type="button"
                  onClick={sendForecastEmail}
                  disabled={sendingForecast || !forecast}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/20 px-3 py-1 text-[11px] font-bold text-white hover:bg-white/20 disabled:opacity-60"
                >
                  <Mail className="w-3 h-3" aria-hidden="true" />
                  {sendingForecast ? 'Sending…' : 'Email forecast'}
                </button>
              </div>
            </div>

            {forecast && forecast.kpis && (
              <div className="grid grid-cols-3 gap-2 mb-3 relative z-10">
                <div className="rounded-xl bg-white/5 border border-white/10 p-2">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Projected</p>
                  <p className="text-sm font-black text-white tracking-tight">
                    ₱{Number(forecast.kpis.projectedGross).toLocaleString('en-US')}
                  </p>
                </div>
                <div className="rounded-xl bg-white/5 border border-white/10 p-2">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Growth</p>
                  <p className={`text-sm font-black tracking-tight ${
                    String(forecast.kpis.grossGrowth).startsWith('-') ? 'text-rose-300' : 'text-emerald-300'
                  }`}>
                    {forecast.kpis.grossGrowth}
                  </p>
                </div>
                <div className="rounded-xl bg-white/5 border border-white/10 p-2">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">High-risk SKUs</p>
                  <p className="text-sm font-black text-white tracking-tight">
                    {forecast.kpis.highRiskSKUs}
                  </p>
                </div>
              </div>
            )}

            <div className="h-40 w-full relative z-10">
              {forecastError ? (
                <div className="h-full flex items-center justify-center text-xs text-rose-300 font-medium">
                  {forecastError}
                </div>
              ) : !forecast ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-400 font-medium">
                  Loading AI forecast…
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={forecast.revenueTrajectory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="navyActualGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.55} />
                        <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="navyForecastGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.45} />
                        <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                    <XAxis dataKey="day" stroke="#94a3b8" fontSize={9} tickLine={false} interval="preserveStartEnd" />
                    <YAxis stroke="#94a3b8" fontSize={9} tickLine={false} tickFormatter={(v) => `₱${Number(v).toLocaleString()}`} />
                    <Tooltip
                      formatter={(v, key) => [v == null ? '—' : `₱${Number(v).toLocaleString()}`, key === 'actual' ? 'Actual' : 'Forecast']}
                      contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.92)', backdropFilter: 'blur(12px)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.15)', color: '#f8fafc' }}
                    />
                    <Area type="monotone" dataKey="actual" stroke="#38bdf8" strokeWidth={2.5} fillOpacity={1} fill="url(#navyActualGrad)" dot={false} connectNulls={false} />
                    <Area type="monotone" dataKey="forecast" stroke="#a78bfa" strokeWidth={2.5} strokeDasharray="4 3" fillOpacity={1} fill="url(#navyForecastGrad)" dot={false} connectNulls={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="flex items-center gap-4 mt-2 relative z-10 text-[10px] font-semibold text-slate-400">
              <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-1 rounded bg-sky-400" />Actual</span>
              <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-[2px] border-t-2 border-dashed border-violet-400" />Forecast</span>
            </div>
          </div>

          {/* EXPIRY WATCHLIST */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 backdrop-blur-xl border border-slate-700/60 p-6 shadow-2xl shadow-slate-900/40 transition-all duration-300 flex flex-col flex-1 min-h-[220px]">
            <div className="absolute top-0 right-0 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="mb-3 relative z-10 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-white tracking-wide">Expiry Watchlist</h3>
                <p className="text-xs text-slate-400">Stock reaching shelf-life threshold soon</p>
              </div>
              <button
                type="button"
                onClick={sendExpiryAlert}
                disabled={sendingExpiry}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/20 px-3 py-1 text-[11px] font-bold text-white hover:bg-white/20 disabled:opacity-60 shrink-0"
              >
                <Mail className="w-3 h-3" aria-hidden="true" />
                {sendingExpiry ? 'Sending…' : 'Email alert now'}
              </button>
            </div>

            <div className="overflow-y-auto flex-1 pr-1 max-h-[200px] relative z-10 navy-scrollbar">
              {!expiryWatchList || expiryWatchList.length === 0 ? (
                <div className="h-full flex items-center justify-center py-8 text-xs text-slate-500">
                  No items expiring within threshold.
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-700/60 uppercase text-[10px] tracking-wider font-bold sticky top-0 bg-slate-900/90 backdrop-blur-md">
                      <th className="pb-2">Product</th>
                      <th className="pb-2 text-right">Status / Days</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 font-medium text-slate-200">
                    {expiryWatchList.map((item, idx) => {
                      const isExpired = item.days <= 0 || item.status === 'Expired';
                      const isCritical = item.days <= 14 && !isExpired;

                      return (
                        <tr key={item.id || idx} className="hover:bg-slate-800/50 transition-colors">
                          <td className="py-2.5 truncate max-w-[140px] sm:max-w-none text-slate-300">
                            {item.product}
                          </td>
                          <td className="py-2.5 text-right">
                            <span
                              className={`inline-flex items-center justify-center font-bold px-2 py-0.5 rounded-lg text-xs ${isExpired
                                  ? 'bg-red-500/30 text-red-400 border border-red-500/60 animate-pulse'
                                  : isCritical
                                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                }`}
                            >
                              {isExpired ? `Expired` : `${item.days} days`}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}