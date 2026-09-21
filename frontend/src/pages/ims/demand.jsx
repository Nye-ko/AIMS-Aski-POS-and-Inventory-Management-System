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
  Target,
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

const pct = (x) => `${Math.round(x * 100)}%`;

const VERDICTS = {
  better: { label: 'Beats a simple guess', cls: 'bg-emerald-500/10 text-emerald-700 border-emerald-300/40' },
  similar: { label: 'About the same as a simple guess', cls: 'bg-slate-500/10 text-slate-600 border-slate-300/40' },
  worse: { label: 'Worse than a simple guess', cls: 'bg-rose-500/10 text-rose-700 border-rose-300/40' },
  insufficient: { label: 'Not enough history yet', cls: 'bg-slate-500/10 text-slate-500 border-slate-300/40' },
};

function biasText(bias) {
  if (bias == null) return null;
  if (Math.abs(bias) < 0.03) return 'no consistent lean';
  return bias < 0 ? `runs ${pct(-bias)} too low` : `runs ${pct(bias)} too high`;
}

function AccuracyTile({ title, metric, needs }) {
  const verdict = VERDICTS[metric?.verdict] || VERDICTS.insufficient;
  const hasData = metric && metric.n > 0 && metric.model?.wape != null;
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{title}</p>
      {hasData ? (
        <>
          <p className="mt-1 text-2xl font-black text-slate-800">
            {pct(metric.model.wape)} <span className="text-xs font-semibold text-slate-500">average miss</span>
          </p>
          <p className="text-[11px] text-slate-500">
            {biasText(metric.model.bias)}
            {metric.baseline?.wape != null && <> · simple guess misses {pct(metric.baseline.wape)}</>}
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm font-semibold text-slate-500">{needs || 'No graded forecasts yet'}</p>
      )}
      <span className={`mt-2 inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${verdict.cls}`}>
        {verdict.label}
      </span>
    </div>
  );
}

function AccuracyCard({ accuracy, failed }) {
  if (failed) {
    return (
      <div className="rounded-3xl border border-slate-200/80 bg-white px-5 py-4 text-xs text-slate-500 shadow-sm">
        Forecast accuracy is unavailable right now.
      </div>
    );
  }
  if (!accuracy) {
    return (
      <div className="rounded-3xl border border-slate-200/80 bg-white px-5 py-4 text-xs text-slate-500 shadow-sm">
        Checking forecast accuracy…
      </div>
    );
  }

  const { backtest, live } = accuracy;
  const btOk = backtest?.available;
  const observed = btOk ? backtest.meta?.observedDays : null;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 shadow-sm shadow-blue-500/30">
          <Target className="h-4 w-4 text-white" />
        </div>
        <div>
          <h2 className="text-xs font-black uppercase tracking-wide text-slate-800">Forecast Accuracy</h2>
          <p className="text-[11px] text-slate-500">
            How far past forecasts were from what actually sold, compared with a simple guess (&ldquo;same as the previous period&rdquo;)
          </p>
        </div>
      </div>

      <div className="space-y-4 p-5">
        {btOk ? (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <AccuracyTile title="Product demand · next 7 days" metric={backtest.units7} />
              <AccuracyTile title="Store revenue · next 7 days" metric={backtest.revenue7} />
              <AccuracyTile title="Store revenue · next 30 days" metric={backtest.revenue30} needs="Needs about 60 days of history" />
            </div>
            <p className="text-[11px] text-slate-500">
              Replayed over {backtest.meta.originsUsed} past days
              {backtest.meta.firstOrigin && <> ({backtest.meta.firstOrigin} to {backtest.meta.lastOrigin})</>} using {observed} days of sales history.
              {observed < 60 && ' That is a short record, so treat these as a rough guide.'}
            </p>
            {(backtest.units7?.range?.coverage != null || backtest.units7?.legacy?.wape != null) && (
              <p className="text-[11px] text-slate-500">
                {backtest.units7?.range?.coverage != null && (
                  <>Actual product sales landed inside the forecast range {pct(backtest.units7.range.coverage)} of the time (the range aims for 80%). </>
                )}
                {backtest.units7?.legacy?.wape != null && (
                  <>
                    The previous method (v{backtest.meta.comparedWith?.engineVersion}) missed {pct(backtest.units7.legacy.wape)} on product demand
                    {backtest.revenue7?.legacy?.wape != null && <> and {pct(backtest.revenue7.legacy.wape)} on weekly revenue</>} over the same days.
                  </>
                )}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-amber-700">{backtest?.reason || 'The backtest is not available.'}</p>
        )}

        <div className="rounded-2xl border border-slate-200/80 px-4 py-3 text-[11px] text-slate-600">
          <span className="font-bold text-slate-700">Saved forecasts, graded live: </span>
          {live?.meta?.snapshotsGraded > 0 ? (
            <>
              {live.meta.snapshotsGraded} graded of {live.meta.snapshotsSaved} saved.
              {live.units7?.model?.wape != null && <> Product demand misses {pct(live.units7.model.wape)} ({biasText(live.units7.model.bias)}).</>}
              {live.revenue7?.model?.wape != null && <> Weekly revenue misses {pct(live.revenue7.model.wape)}.</>}
            </>
          ) : (
            <>
              {live?.meta?.snapshotsSaved > 0
                ? `${live.meta.snapshotsSaved} saved so far; grading starts once a saved forecast has 7 completed days.`
                : 'One forecast is saved each day; grading starts once the first has 7 completed days.'}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

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
    <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 shadow-sm shadow-blue-500/30">
          <Truck className="h-4 w-4 text-white" />
        </div>
        <div>
          <h2 className="text-xs font-black uppercase tracking-wide text-slate-800">Supplier Lead Times</h2>
          <p className="text-[11px] text-slate-500">
            Days from ordering to delivery. A longer lead time means a product is flagged for reorder sooner.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-3">
        {suppliers.map((sup) => {
          const value = drafts[sup.id] ?? sup.leadTimeDays;
          const dirty = drafts[sup.id] !== undefined && Number(drafts[sup.id]) !== sup.leadTimeDays;
          return (
            <div key={sup.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/60 px-4 py-3">
              <span className="truncate text-xs font-bold text-slate-700">{sup.name}</span>
              <span className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="90"
                  value={value}
                  disabled={!canEdit}
                  onChange={(e) => setDrafts((d) => ({ ...d, [sup.id]: e.target.value }))}
                  className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-center text-xs font-bold text-slate-800 disabled:bg-slate-100 disabled:text-slate-500"
                />
                <span className="text-[11px] text-slate-500">days</span>
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
      {message && <p className="px-5 pb-4 text-xs text-rose-600">{message}</p>}
    </div>
  );
}

export default function Demand() {
  const [demandMode, setDemandMode] = useState('current'); // 'current' (30 days) | 'future' (60 days)
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [accuracyFailed, setAccuracyFailed] = useState(false);
  const fetchForecast = async () => {
    setLoading(true);
    setError(null);
    try {
      const days = demandMode === 'future' ? 60 : 30;
      // Fetching predictions from Express backend endpoint
      const res = await axios.get(`http://localhost:5000/api/forecast?days=${days}`, { headers: authHeader() });

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

  // Accuracy does not depend on the 30/60-day toggle, so it loads once and never blocks the page.
  useEffect(() => {
    let cancelled = false;
    axios
      .get('http://localhost:5000/api/forecast/accuracy', { headers: authHeader() })
      .then((res) => {
        if (cancelled) return;
        if (res.data.success) setAccuracy(res.data.data);
        else setAccuracyFailed(true);
      })
      .catch(() => {
        if (!cancelled) setAccuracyFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
            onClick={fetchForecast}
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
  const skuError = new Map(((accuracy?.backtest?.available && accuracy.backtest.perSku) || []).map((r) => [r.sku, r]));

  return (
    <div className="space-y-6">
      {/* ===== HEADER ====== */}
      <header className="relative z-30 flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-white via-white/90 to-blue-200/60 backdrop-blur-xl border border-white/80 rounded-3xl px-8 py-4 shadow-xl shadow-blue-500/10">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/30">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-blue-600">AMPC</p>
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">DEMAND & SALES FORECASTING</h2>
          </div>
        </div>

        {/* Forecast window toggle */}
        <div className="flex items-center gap-2 bg-white/60 backdrop-blur-sm p-1.5 rounded-2xl border border-white/70">
          <button
            onClick={() => setDemandMode('current')}
            className={`flex items-center gap-2 px-4 py-2 font-bold text-xs rounded-xl transition-all cursor-pointer ${
              demandMode === 'current'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>30-Day Outlook</span>
          </button>
          <button
            onClick={() => setDemandMode('future')}
            className={`flex items-center gap-2 px-4 py-2 font-bold text-xs rounded-xl transition-all cursor-pointer ${
              demandMode === 'future'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>60-Day Forecast</span>
          </button>
        </div>
      </header>

      {/* DATA-QUALITY NOTICES — say so when numbers come from the built-in engine or thin history */}
      {(meta.source === 'fallback' || (meta.warnings && meta.warnings.length > 0)) && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            {meta.source === 'fallback' && (
              <p className="font-bold">AI service is offline — showing the built-in estimate (same method, no trend modelling).</p>
            )}
            {(meta.warnings || []).map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        </div>
      )}

      {/* SUMMARY KPI CARDS — same glass-gradient card treatment as finance.jsx's 3 core KPI cards */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {/* Gross Projected Revenue */}
        <div className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-white/80 via-blue-100/30 to-indigo-300/40 backdrop-blur-xl border border-white/80 p-6 shadow-xl shadow-blue-500/10 hover:shadow-2xl hover:scale-[1.02] transition-all duration-300">
          <div className="flex items-center justify-between mb-3 relative z-10">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">
              Projected Gross
            </span>
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/30">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <h3 className="text-3xl font-black text-slate-800 tracking-tight mb-2 relative z-10">
            ₱{kpis.projectedGross?.toLocaleString() || '0'}
          </h3>
          <div className="flex items-center gap-2 text-xs relative z-10">
            <span className={`inline-flex items-center font-bold px-2.5 py-1 rounded-xl bg-white/70 backdrop-blur-md shadow-sm ${growthDown ? 'text-rose-600' : growthKnown ? 'text-emerald-600' : 'text-slate-500'}`}>
              {growthKnown && (growthDown ? <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" /> : <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" />)}
              {kpis.grossGrowth ?? 'n/a'}
            </span>
            <span className="text-slate-500 font-medium">recent pace vs history · next {horizonDays} days</span>
          </div>
          {kpis.projectedGrossLow != null && kpis.projectedGrossHigh != null && (
            <p className="mt-2 text-[11px] font-medium text-slate-500 relative z-10">
              Likely between ₱{kpis.projectedGrossLow.toLocaleString()} and ₱{kpis.projectedGrossHigh.toLocaleString()} (4 in 5 chance)
            </p>
          )}
        </div>

        {/* Net Projected Revenue */}
        <div className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-white/80 via-blue-100/30 to-indigo-300/40 backdrop-blur-xl border border-white/80 p-6 shadow-xl shadow-blue-500/10 hover:shadow-2xl hover:scale-[1.02] transition-all duration-300">
          <div className="flex items-center justify-between mb-3 relative z-10">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">
              Projected Net
            </span>
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-600 text-white shadow-md shadow-blue-500/30">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <h3 className="text-3xl font-black text-slate-800 tracking-tight mb-2 relative z-10">
            ₱{kpis.projectedNet?.toLocaleString() || '0'}
          </h3>
          <div className="flex items-center gap-2 text-xs relative z-10">
            <span className="text-slate-500 font-medium">After estimated discounts</span>
          </div>
        </div>

        {/* Discount Baseline */}
        <div className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-white/80 via-blue-100/30 to-indigo-300/40 backdrop-blur-xl border border-white/80 p-6 shadow-xl shadow-blue-500/10 hover:shadow-2xl hover:scale-[1.02] transition-all duration-300">
          <div className="flex items-center justify-between mb-3 relative z-10">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">
              Est. Discounts
            </span>
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-600 text-white shadow-md shadow-blue-500/30">
              <PackageCheck className="w-5 h-5" />
            </div>
          </div>
          <h3 className="text-3xl font-black text-slate-800 tracking-tight mb-2 relative z-10">
            ₱{kpis.projectedDiscounts?.toLocaleString() || '0'}
          </h3>
          <div className="flex items-center gap-2 text-xs relative z-10">
            <span className="inline-flex items-center font-bold px-2.5 py-1 rounded-xl bg-white/70 backdrop-blur-md shadow-sm text-amber-600">
              {kpis.discountRatePct ?? 0}%
            </span>
            <span className="text-slate-500 font-medium">of gross, from actual discounts</span>
          </div>
        </div>

        {/* Stock Alerts */}
        <div className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-white/80 via-blue-100/30 to-indigo-300/40 backdrop-blur-xl border border-white/80 p-6 shadow-xl shadow-blue-500/10 hover:shadow-2xl hover:scale-[1.02] transition-all duration-300">
          <div className="flex items-center justify-between mb-3 relative z-10">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">
              Stock Alerts
            </span>
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-rose-600 to-pink-600 text-white shadow-md shadow-blue-500/30">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
          <h3 className="text-3xl font-black text-slate-800 tracking-tight mb-2 relative z-10">
            {kpis.highRiskSKUs} Items
          </h3>
          <div className="flex items-center gap-2 text-xs relative z-10">
            <span className={`inline-flex items-center font-bold px-2.5 py-1 rounded-xl bg-white/70 backdrop-blur-md shadow-sm ${kpis.highRiskSKUs === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {kpis.highRiskSKUs === 0 ? <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" /> : <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />}
              {kpis.highRiskSKUs === 0 ? 'All Clear' : `${kpis.highRiskSKUs} Flagged`}
            </span>
            <span className="text-slate-500 font-medium">reorder or action</span>
          </div>
        </div>
      </div>

      <AccuracyCard accuracy={accuracy} failed={accuracyFailed} />

      {/* REVENUE TRAJECTORY GRAPH */}
      <div className="relative overflow-hidden bg-white border border-slate-200/80 rounded-3xl shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-sm shadow-blue-500/30">
            <TrendingUp className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-xs font-black text-slate-800 uppercase tracking-wide">Sales & Revenue Trajectory</h2>
            <p className="text-[11px] text-slate-500">Historical actual daily total vs AI projected trajectory</p>
          </div>
        </div>

        <div className="p-6">
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
        <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-sm shadow-blue-500/30">
              <PackageCheck className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-xs font-black text-slate-800 uppercase tracking-wide">SKU Demand & Reorder Logic</h2>
              <p className="text-[11px] text-slate-500">Item velocity, predicted 7-day demand, and suggested purchase order quantities</p>
            </div>
          </div>
          <span className="text-[11px] text-blue-700 font-bold bg-blue-500/10 border border-blue-200/50 px-2.5 py-1 rounded-full">{skuDemandList.length} items</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-700 bg-slate-50/80 border-b-2 border-slate-200 uppercase text-[11px] tracking-wider font-extrabold">
                <th className="px-4 py-3.5">SKU</th>
                <th className="px-4 py-3.5">Product Name</th>
                <th className="px-4 py-3.5 text-center">Current Stock</th>
                <th className="px-4 py-3.5 text-center">Daily Demand</th>
                <th className="px-4 py-3.5 text-center">7-Day Target</th>
                <th className="px-4 py-3.5 text-center">{horizonDays}-Day Demand</th>
                <th className="px-4 py-3.5 text-center" title="How far past 7-day forecasts for this product were from what sold (backtest)">7-Day Miss</th>
                <th className="px-4 py-3.5 text-center" title="Order when stock on hand plus stock on order drops to this level">Reorder At</th>
                <th className="px-4 py-3.5 text-center">Suggested Reorder</th>
                <th className="px-4 py-3.5 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {skuDemandList.map((item, idx) => (
                <tr key={item.id} className={`hover:bg-slate-50/80 transition-colors ${idx % 2 === 1 ? 'bg-slate-50/40' : ''}`}>
                  <td className="px-4 py-3.5 font-mono text-[11px] font-bold text-slate-500">{item.sku}</td>
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
                    {item.stock}
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
                      <span className="ml-1 text-[10px] font-medium text-slate-400" title="Likely range (4 in 5 chance)">
                        ({item.forecast7Low}–{item.forecast7High})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-center">{item.forecastHorizon}</td>
                  <td
                    className="px-4 py-3.5 text-center text-slate-600"
                    title={
                      skuError.get(item.sku)?.wape != null
                        ? `Simple guess: ${pct(skuError.get(item.sku).baselineWape ?? 0)} · ${skuError.get(item.sku).n} past forecasts`
                        : 'Not enough sales history to grade'
                    }
                  >
                    {skuError.get(item.sku)?.wape != null ? pct(skuError.get(item.sku).wape) : '—'}
                  </td>
                  <td
                    className="px-4 py-3.5 text-center text-slate-600"
                    title={`Demand over the ${item.leadTimeDays}-day lead time + ${item.safetyStock} safety stock${
                      item.minStock > item.reorderPoint - 1 ? ' (raised to the minimum stock you set)' : ''
                    }`}
                  >
                    {item.reorderPoint}
                  </td>
                  <td
                    className="px-4 py-3.5 text-center font-bold text-blue-600"
                    title={item.reorderQty > 0 ? `Brings stock plus incoming up to ${item.orderUpTo}` : 'Nothing to order right now'}
                  >
                    {item.reorderQty > 0 ? `+${item.reorderQty}` : '0'}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                        item.status === 'REORDER NOW'
                          ? 'bg-rose-500/10 text-rose-700 border border-rose-300/40'
                          : item.status === 'EXPIRY RISK'
                          ? 'bg-amber-500/10 text-amber-700 border border-amber-300/40'
                          : 'bg-emerald-500/10 text-emerald-700 border border-emerald-300/40'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      {item.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <SupplierLeadTimes onSaved={fetchForecast} />
    </div>
  );
}
