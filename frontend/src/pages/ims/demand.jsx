import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { authHeader } from '../../auth/apiFetch';
import { useAuth } from '../../auth/AuthContext';
import {
  TrendingUp,
  AlertTriangle,
  PackageCheck,
  DollarSign,
  RefreshCw,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  Truck
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from 'recharts';

// Days from placing an order with a supplier to receiving it. Every product's reorder point is built
// from this, so it is editable here (inventory role) and the forecast reloads after each save.
function SupplierLeadTimes({ onSaved }) {
  const { role } = useAuth();
  const [suppliers, setSuppliers] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState(null);
  const canEdit = role === 'INVENTORY';

  useEffect(() => {
    let cancelled = false;
    axios
      .get('http://localhost:5000/api/suppliers', { headers: authHeader() })
      .then((res) => {
        if (!cancelled) setSuppliers(res.data);
      })
      .catch(() => {
        if (!cancelled) setSuppliers([]); // this role may not read suppliers: hide the panel
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!suppliers || suppliers.length === 0) return null;

  const save = async (supplier) => {
    const days = Number(drafts[supplier.id]);
    setBusyId(supplier.id);
    setMessage(null);
    try {
      const res = await axios.patch(
        `http://localhost:5000/api/suppliers/${supplier.id}`,
        { leadTimeDays: days },
        { headers: authHeader() }
      );
      setSuppliers((list) => list.map((x) => (x.id === supplier.id ? { ...x, leadTimeDays: res.data.leadTimeDays } : x)));
      setDrafts((d) => {
        const next = { ...d };
        delete next[supplier.id];
        return next;
      });
      onSaved();
    } catch (err) {
      setMessage(err.response?.data?.error || 'Could not save the lead time.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 border border-slate-700/60 shadow-2xl shadow-slate-900/40">
      <div className="pointer-events-none absolute top-0 right-0 h-48 w-48 rounded-full bg-sky-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-blue-600/15 blur-2xl" />
      <div className="flex items-center gap-2.5 border-b relative z-10 border-slate-700/60 px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 shadow-sm shadow-blue-500/30">
          <Truck className="h-4 w-4 text-white" />
        </div>
        <div>
          <h2 className="text-xs font-black uppercase tracking-wide text-white">Supplier Lead Times</h2>
          <p className="text-[11px] text-slate-400">
            Days from ordering to delivery. A longer lead time means a product is flagged for reorder sooner.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 relative z-10 gap-2 sm:gap-3 p-3 sm:p-5 md:grid-cols-3">
        {suppliers.map((sup) => {
          const value = drafts[sup.id] ?? sup.leadTimeDays;
          const dirty = drafts[sup.id] !== undefined && Number(drafts[sup.id]) !== sup.leadTimeDays;
          return (
            <div key={sup.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-700/60 bg-white/5 px-4 py-3">
              <span className="truncate text-xs font-bold text-slate-200">{sup.name}</span>
              <span className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="90"
                  value={value}
                  disabled={!canEdit}
                  onChange={(e) => setDrafts((d) => ({ ...d, [sup.id]: e.target.value }))}
                  className="w-16 rounded-lg border border-slate-600 bg-slate-800/60 px-2 py-1 text-center text-xs font-bold text-white disabled:bg-slate-800/40 disabled:text-slate-400"
                />
                <span className="text-[11px] text-slate-400">days</span>
                {canEdit && dirty && (
                  <button
                    onClick={() => save(sup)}
                    disabled={busyId === sup.id}
                    className="rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {busyId === sup.id ? 'Saving…' : 'Save'}
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {message && <p className="px-5 pb-4 text-xs relative z-10 text-rose-400">{message}</p>}
    </div>
  );
}

export default function Demand() {
  const [demandMode, setDemandMode] = useState('current'); // 'current' (30 days) | 'future' (60 days)
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // `refresh` skips the server's short-lived forecast cache (the Refresh and Retry buttons).
  const fetchForecast = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const days = demandMode === 'future' ? 60 : 30;
      // Fetching predictions from Express backend endpoint
      const res = await axios.get(`http://localhost:5000/api/forecast?days=${days}${refresh === true ? '&refresh=1' : ''}`, {
        headers: authHeader(),
      });

      if (res.data.success) {
        setForecast(res.data.data);
      } else {
        setError('Failed to load forecast data from server');
      }
    } catch (err) {
      console.error('Error fetching AI predictions:', err);
      setError('Cannot connect to AI service. Ensure backend and FastAPI are running.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchForecast();
  }, [demandMode]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-600 font-bold text-sm">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
          <span>Generating AI Demand & Revenue Predictions...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="bg-gradient-to-br from-white via-white/90 to-blue-200/60 backdrop-blur-xl border border-white/80 p-6 rounded-3xl shadow-xl shadow-blue-500/10 max-w-md text-center">
          <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
          <p className="text-rose-600 font-bold text-sm mb-2">{error}</p>
          <button
            onClick={() => fetchForecast(true)}
            className="px-4 py-2 bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-xs rounded-full shadow-md hover:shadow-lg hover:shadow-blue-500/30 transition-all cursor-pointer"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  const { kpis, revenueTrajectory, skuDemandList, meta = {} } = forecast;
  const growthKnown = !!kpis.grossGrowth && kpis.grossGrowth !== 'n/a';
  const growthDown = growthKnown && String(kpis.grossGrowth).startsWith('-');
  const horizonDays = kpis.horizonDays || (demandMode === 'future' ? 60 : 30);
  const chartData = (revenueTrajectory || []).map((p) => ({
    ...p,
    band: p.forecastLow != null && p.forecastHigh != null ? [p.forecastLow, p.forecastHigh] : null,
  }));

  return (
    <div className="space-y-6">
      {/* ===== HEADER ====== */}
      <header className="relative z-30 mb-6 lg:mb-12 flex flex-wrap items-center justify-between gap-3 sm:gap-4 bg-gradient-to-r from-white via-white/90 to-blue-200/60 backdrop-blur-xl border border-white/80 rounded-3xl px-4 sm:px-8 py-3 sm:py-4 shadow-xl shadow-blue-500/10">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/30">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-blue-600">AMPC</p>
            <h2 className="text-lg sm:text-2xl font-black text-slate-800 tracking-tight">DEMAND & SALES FORECASTING</h2>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
        {/* Forecast window toggle */}
        <div className="flex flex-1 sm:flex-none items-center gap-1 sm:gap-2 bg-white/60 backdrop-blur-sm p-1 sm:p-1.5 rounded-xl sm:rounded-2xl border border-white/70">
          <button
            onClick={() => setDemandMode('current')}
            className={`flex flex-1 sm:flex-none justify-center items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 font-bold text-[10px] sm:text-xs whitespace-nowrap rounded-xl transition-all cursor-pointer ${
              demandMode === 'current'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>30-Day Outlook</span>
          </button>
          <button
            onClick={() => setDemandMode('future')}
            className={`flex flex-1 sm:flex-none justify-center items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 font-bold text-[10px] sm:text-xs whitespace-nowrap rounded-xl transition-all cursor-pointer ${
              demandMode === 'future'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>60-Day Forecast</span>
          </button>
        </div>
        <button
          onClick={() => fetchForecast(true)}
          className="flex shrink-0 items-center gap-2 p-2 sm:px-4 sm:py-2.5 font-bold text-xs rounded-xl sm:rounded-2xl bg-white/60 border border-white/70 text-slate-600 hover:text-slate-900 transition-all cursor-pointer"
          title="Recalculate now instead of using the last result (results are reused for a few minutes)"
        >
          <RefreshCw className="w-4 h-4" />
          <span className="hidden sm:inline">Refresh</span>
        </button>
        </div>
      </header>

      {/* DATA-QUALITY NOTICES — say so when numbers come from the built-in engine or thin history */}
      {(meta.source === 'fallback' || (meta.warnings && meta.warnings.length > 0)) && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 sm:px-5 sm:py-3 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            {meta.source === 'fallback' && (
              <p className="font-bold">AI service is not answering — showing the built-in estimate (same method, same numbers). It will try the AI service again shortly.</p>
            )}
            {(meta.warnings || []).map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        </div>
      )}

      {/* SUMMARY KPI CARDS — same glass-gradient card treatment as finance.jsx's 3 core KPI cards */}
      <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:gap-6 lg:grid-cols-4">
        {/* Gross Projected Revenue */}
        <div className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-white/80 via-blue-100/30 to-indigo-300/40 backdrop-blur-xl border border-white/80 px-3 py-3 sm:px-5 sm:py-4 shadow-xl shadow-blue-500/10 hover:shadow-2xl hover:scale-[1.02] transition-all duration-300">
          <div className="flex items-center justify-between gap-1.5 mb-2 relative z-10">
            <span className="text-[9px] sm:text-xs leading-tight font-bold text-slate-600 uppercase tracking-wider">
              Projected Gross
            </span>
            <div className="p-1.5 sm:p-2 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/30">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <h3 className="text-lg sm:text-2xl font-black text-slate-800 tracking-tight mb-1.5 relative z-10">
            ₱{kpis.projectedGross?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '0'}
          </h3>
          <div className="flex items-center gap-2 text-xs relative z-10">
            <span className={`inline-flex items-center font-bold px-2 py-0.5 rounded-lg bg-white/70 backdrop-blur-md shadow-sm ${growthDown ? 'text-rose-600' : growthKnown ? 'text-emerald-600' : 'text-slate-500'}`}>
              {growthKnown && (growthDown ? <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" /> : <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" />)}
              {kpis.grossGrowth ?? 'n/a'}
            </span>
          </div>
        </div>

        {/* Net Projected Revenue */}
        <div className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-white/80 via-blue-100/30 to-indigo-300/40 backdrop-blur-xl border border-white/80 px-3 py-3 sm:px-5 sm:py-4 shadow-xl shadow-blue-500/10 hover:shadow-2xl hover:scale-[1.02] transition-all duration-300">
          <div className="flex items-center justify-between gap-1.5 mb-2 relative z-10">
            <span className="text-[9px] sm:text-xs leading-tight font-bold text-slate-600 uppercase tracking-wider">
              Projected Net
            </span>
            <div className="p-1.5 sm:p-2 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-600 text-white shadow-md shadow-blue-500/30">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <h3 className="text-lg sm:text-2xl font-black text-slate-800 tracking-tight relative z-10">
            ₱{kpis.projectedNet?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '0'}
          </h3>
        </div>

        {/* Discount Baseline */}
        <div className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-white/80 via-blue-100/30 to-indigo-300/40 backdrop-blur-xl border border-white/80 px-3 py-3 sm:px-5 sm:py-4 shadow-xl shadow-blue-500/10 hover:shadow-2xl hover:scale-[1.02] transition-all duration-300">
          <div className="flex items-center justify-between gap-1.5 mb-2 relative z-10">
            <span className="text-[9px] sm:text-xs leading-tight font-bold text-slate-600 uppercase tracking-wider">
              Est. Discounts
            </span>
            <div className="p-1.5 sm:p-2 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-600 text-white shadow-md shadow-blue-500/30">
              <PackageCheck className="w-4 h-4" />
            </div>
          </div>
          <h3 className="text-lg sm:text-2xl font-black text-slate-800 tracking-tight mb-1.5 relative z-10">
            ₱{kpis.projectedDiscounts?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '0'}
          </h3>
          <div className="flex items-center gap-2 text-xs relative z-10">
            <span className="inline-flex items-center font-bold px-2 py-0.5 rounded-lg bg-white/70 backdrop-blur-md shadow-sm text-amber-600">
              {kpis.discountRatePct ?? 0}%
            </span>
          </div>
        </div>

        {/* Stock Alerts */}
        <div className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-white/80 via-blue-100/30 to-indigo-300/40 backdrop-blur-xl border border-white/80 px-3 py-3 sm:px-5 sm:py-4 shadow-xl shadow-blue-500/10 hover:shadow-2xl hover:scale-[1.02] transition-all duration-300">
          <div className="flex items-center justify-between gap-1.5 mb-2 relative z-10">
            <span className="text-[9px] sm:text-xs leading-tight font-bold text-slate-600 uppercase tracking-wider">
              Stock Alerts
            </span>
            <div className="p-1.5 sm:p-2 rounded-xl bg-gradient-to-tr from-rose-600 to-pink-600 text-white shadow-md shadow-blue-500/30">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <h3 className="text-lg sm:text-2xl font-black text-slate-800 tracking-tight mb-1.5 relative z-10">
            {kpis.highRiskSKUs} Items
          </h3>
          <div className="flex items-center gap-2 text-xs relative z-10">
            <span className={`inline-flex items-center font-bold px-2 py-0.5 rounded-lg bg-white/70 backdrop-blur-md shadow-sm ${kpis.highRiskSKUs === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {kpis.highRiskSKUs === 0 ? <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" /> : <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />}
              {kpis.highRiskSKUs === 0 ? 'All Clear' : `${kpis.highRiskSKUs} Flagged`}
            </span>
          </div>
        </div>
      </div>

      {/* REVENUE TRAJECTORY GRAPH */}
      <div className="relative overflow-hidden bg-white border border-slate-200/80 rounded-3xl shadow-sm">
        <div className="px-4 py-3 sm:px-5 sm:py-4 border-b border-slate-100 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-sm shadow-blue-500/30">
            <TrendingUp className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-xs font-black text-slate-800 uppercase tracking-wide">Sales & Revenue Trajectory</h2>
            <p className="text-[11px] text-slate-500">Historical actual daily total vs AI projected trajectory</p>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorForecast" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(val) => `₱${val}`} />
                <Tooltip
                  formatter={(value, name) => [
                    Array.isArray(value)
                      ? `₱${Number(value[0]).toLocaleString()} – ₱${Number(value[1]).toLocaleString()}`
                      : `₱${Number(value).toLocaleString()}`,
                    name,
                  ]}
                />
                <Area type="monotone" dataKey="band" stroke="none" fill="#10b981" fillOpacity={0.15} name="Likely range (80%)" />
                <Area type="monotone" dataKey="actual" stroke="#4f46e5" fillOpacity={1} fill="url(#colorActual)" name="Actual Sales" />
                <Area type="monotone" dataKey="forecast" stroke="#10b981" strokeDasharray="5 5" fillOpacity={1} fill="url(#colorForecast)" name="AI Forecast" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* SKU DEMAND & REORDER TABLE */}
      <div className="relative overflow-hidden bg-white border border-slate-200/80 rounded-3xl shadow-sm">
        <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-slate-100 flex justify-between items-center gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 shrink-0 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-sm shadow-blue-500/30">
              <PackageCheck className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs font-black text-slate-800 uppercase tracking-wide">SKU Demand & Reorder Logic</h2>
              <p className="text-[10px] sm:text-[11px] leading-snug text-slate-500">Item velocity, predicted 7-day demand, and suggested purchase order quantities</p>
            </div>
          </div>
          <span className="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-full bg-slate-50 border border-slate-200 px-2.5 sm:px-3 py-1 text-[10px] sm:text-[11px] font-bold text-slate-600"><span className="w-1.5 h-1.5 rounded-full bg-blue-500" />{skuDemandList.length} items</span>
        </div>

        <div className="overflow-x-auto overflow-y-auto max-h-[700px]">
          <table className="w-full min-w-[960px] text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur shadow-[0_1px_0_0_rgb(226,232,240)]">
              <tr className="text-slate-500 uppercase text-[10px] tracking-widest font-extrabold whitespace-nowrap">
                <th className="px-4 py-3.5">SKU</th>
                <th className="px-4 py-3.5">Product Name</th>
                <th className="px-4 py-3.5 text-center">Current Stock</th>
                <th className="px-4 py-3.5 text-center">Daily Demand</th>
                <th className="px-4 py-3.5 text-center">7-Day Target</th>
                <th className="px-4 py-3.5 text-center">{horizonDays}-Day Demand</th>
                <th className="px-4 py-3.5 text-center" title="Order when stock on hand plus stock on order drops to this level">Reorder At</th>
                <th className="px-4 py-3.5 text-center">Suggested Reorder</th>
                <th className="px-4 py-3.5 text-right whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {skuDemandList.map((item) => (
                <tr key={item.id} className={`group transition-colors ${item.status === 'REORDER NOW' ? 'bg-rose-50/30 hover:bg-rose-50/70' : 'hover:bg-blue-50/40'}`}>
                  <td className="relative px-4 py-3.5">
                    <span className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full ${item.status === 'REORDER NOW' ? 'bg-rose-400' : item.status === 'EXPIRY RISK' ? 'bg-amber-400 opacity-0 group-hover:opacity-100' : 'bg-blue-500 opacity-0 group-hover:opacity-100'} transition-opacity`} />
                    <span className="font-mono text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-1 rounded-md">{item.sku}</span>
                  </td>
                  <td className="px-4 py-3.5 font-bold text-slate-900">
                    {item.name}
                    {(item.confidence === 'low' || item.confidence === 'none') && (
                      <span className="ml-2 text-[10px] font-semibold text-amber-600" title={`${item.dataDays} day(s) of sales history`}>
                        limited data
                      </span>
                    )}
                    {item.stockoutAdjusted && (
                      <span
                        className="ml-2 text-[10px] font-semibold text-sky-600"
                        title={`Out of stock on ${item.stockoutDays} of the last ${meta.rateWindowDays || 28} days. Those days are left out so the empty shelf is not mistaken for low demand.`}
                      >
                        out of stock {item.stockoutDays}d
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <span className={`font-extrabold tabular-nums ${item.stock <= item.reorderPoint ? 'text-rose-600' : 'text-slate-800'}`}>{item.stock}</span>
                    {item.onOrder > 0 && (
                      <span className="ml-1 text-[10px] font-semibold text-indigo-600" title="Units on pending purchase orders">
                        +{item.onOrder} on order
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-center">{item.dailyDemand} / day</td>
                  <td className="px-4 py-3.5 text-center">
                    {item.forecast7Day}
                    {item.forecast7Low != null && item.forecast7High != null && (
                      <span className="ml-1 text-[10px] font-medium text-slate-400" title={`Likely range (4 in 5 chance) · ${item.confidence} confidence, ${item.dataDays} day(s) of sales history`}>
                        ({item.forecast7Low}–{item.forecast7High})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-center">{item.forecastHorizon}</td>
                  <td
                    className="px-4 py-3.5 text-center text-slate-600"
                    title={`Demand over the ${item.leadTimeDays}-day lead time + ${item.safetyStock} safety stock${
                      item.minStock > item.reorderPoint - 1 ? ' (raised to the minimum stock you set)' : ''
                    }`}
                  >
                    {item.reorderPoint}
                  </td>
                  <td
                    className="px-4 py-3.5 text-center"
                    title={item.reorderQty > 0 ? `Brings stock plus incoming up to ${item.orderUpTo}` : 'Nothing to order right now'}
                  >
                    <span className={`inline-flex min-w-[36px] justify-center rounded-lg px-2 py-1 text-[11px] font-extrabold tabular-nums ${item.reorderQty > 0 ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100' : 'bg-slate-50 text-slate-400'}`}>
                      {item.reorderQty > 0 ? `+${item.reorderQty}` : '0'}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                    <span
                      className={`inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 rounded-full text-[10px] font-bold ${
                        item.status === 'REORDER NOW'
                          ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
                          : item.status === 'EXPIRY RISK'
                          ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                          : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      {item.status === 'HEALTHY' ? 'OPTIMAL' : item.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <SupplierLeadTimes onSaved={() => fetchForecast(true)} />

      <p className="text-center text-[11px] text-slate-400">
        Engine {meta.engine} v{meta.engineVersion} · {meta.source === 'fallback' ? 'built-in estimate' : 'AI service'}
        {meta.generatedAt && <> · calculated {new Date(meta.generatedAt).toLocaleTimeString()}</>}
        {meta.cached && <> (reused; press Refresh to recalculate)</>} · {meta.observedDays} day(s) of sales history
      </p>
    </div>
  );
}
