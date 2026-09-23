import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { 
  BarChart3, 
  Bell, 
  DollarSign, 
  Wallet, 
  Scale, 
  ArrowUpRight, 
  ArrowDownRight,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Wifi
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';
import NotificationPanel from './NotificationPanel';
import { useAlertNotifications } from '../../hooks/useAlertNotifications';
import { authHeader, getAuthToken } from '../../auth/apiFetch';

export default function Finance() {
  const [revenueComparisonData, setRevenueComparisonData] = useState([]);
  const [registerVarianceData, setRegisterVarianceData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const notif = useAlertNotifications();
  const [isConnected, setIsConnected] = useState(false);

  // Helper function to extract array data safely
  const handleDataResponse = (responseData) => {
    if (!responseData) return;
    
    // Support both direct array payload and nested object payload
    const revenue = responseData.revenueComparisonData || responseData.revenue || [];
    const variance = responseData.registerVarianceData || responseData.variance || [];
    
    setRevenueComparisonData(revenue);
    setRegisterVarianceData(variance);
  };

  // 1. Fetch metrics directly from Port 5000
  const fetchFinanceData = async () => {
    setLoading(true);
    setError(null);
    try {
      // FULL URL TO EXPRESS SERVER (Port 5000)
      const response = await axios.get('http://localhost:5000/api/finance/summary', { headers: authHeader() });
      handleDataResponse(response.data);
    } catch (err) {
      console.error('Failed to load financial data:', err);
      setError('Failed to connect to backend server at http://localhost:5000');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFinanceData();

    const socket = io('http://localhost:5000', {
      transports: ['websocket', 'polling'],
      auth: { token: getAuthToken() },
    });
    setIsConnected(socket.connected);

    function onConnect() { setIsConnected(true); }
    function onDisconnect() { setIsConnected(false); }
    function onFinanceUpdated(newData) { handleDataResponse(newData); }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('finance_updated', onFinanceUpdated);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('finance_updated', onFinanceUpdated);
      socket.disconnect();
    };
  }, []);

  // Compute summary metrics dynamically from state arrays
  const totalGross = revenueComparisonData.reduce((acc, curr) => acc + (Number(curr.gross) || 0), 0);
  const totalNet = revenueComparisonData.reduce((acc, curr) => acc + (Number(curr.net) || 0), 0);
  const netRetentionRate = totalGross > 0 ? ((totalNet / totalGross) * 100).toFixed(1) : '0.0';
  const totalVariance = registerVarianceData.reduce((acc, curr) => acc + (Number(curr.variance) || 0), 0);

  const topMetrics = [
    {
      title: 'Gross Revenue',
      value: `₱${totalGross.toLocaleString()}`,
      change: '+12.4%',
      isPositive: true,
      subtext: 'Before discounts & voids',
      icon: DollarSign,
      color: 'from-blue-600 to-indigo-600'
    },
    {
      title: 'Net Revenue',
      value: `₱${totalNet.toLocaleString()}`,
      change: `${netRetentionRate}%`,
      isPositive: true,
      subtext: 'Actual retained income',
      icon: Wallet,
      color: 'from-emerald-600 to-teal-600'
    },
    {
      title: 'Drawer Variance',
      value: `₱${Math.abs(totalVariance).toLocaleString()} ${totalVariance < 0 ? 'Short' : 'Over'}`,
      change: totalVariance === 0 ? '0.0%' : `${totalVariance < 0 ? '-' : '+'}${Math.abs(totalVariance)}`,
      isPositive: totalVariance >= 0,
      subtext: totalVariance < 0 ? 'Shortage detected across shifts' : 'Drawer balanced/over',
      icon: Scale,
      color: totalVariance < 0 ? 'from-rose-600 to-pink-600' : 'from-amber-500 to-orange-600'
    }
  ];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 space-y-4">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
        <p className="text-slate-600 font-semibold">Fetching financial metrics...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ===== HEADER ===== */}
      <header className="relative z-30 flex items-center justify-between bg-gradient-to-r from-white via-white/90 to-blue-200/60 backdrop-blur-xl border border-white/80 rounded-3xl px-8 py-4 shadow-xl shadow-blue-500/10">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/30">
            <BarChart3 className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-blue-600">AMPC POS</p>
              <span className={`inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                isConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
              }`}>
                <Wifi className="w-3 h-3" />
                {isConnected ? 'LIVE' : 'OFFLINE'}
              </span>
            </div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">
              FINANCE & AUDIT CONTROL
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-3 relative">
          <button 
            onClick={fetchFinanceData} 
            className="p-3 rounded-2xl bg-white border border-slate-200/60 text-slate-700 hover:bg-slate-50 transition shadow-sm"
            title="Refresh Data"
          >
            <RefreshCw className="w-5 h-5 text-slate-700" />
          </button>

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
        </div>
      </header>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 text-sm font-semibold flex items-center justify-between">
          <span>{error}</span>
          <button onClick={fetchFinanceData} className="underline">Retry</button>
        </div>
      )}

      {/* ===== 3 CORE KPI CARDS ===== */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {topMetrics.map((item, idx) => {
          const Icon = item.icon;
          return (
            <div
              key={idx}
              className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-white/80 via-blue-100/30 to-indigo-300/40 backdrop-blur-xl border border-white/80 p-6 shadow-xl shadow-blue-500/10 hover:shadow-2xl hover:scale-[1.02] transition-all duration-300"
            >
              <div className="flex items-center justify-between mb-3 relative z-10">
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                  {item.title}
                </span>
                <div className={`p-2.5 rounded-2xl bg-gradient-to-tr ${item.color} text-white shadow-md shadow-blue-500/30`}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
              <h3 className="text-3xl font-black text-slate-800 tracking-tight mb-2 relative z-10">
                {item.value}
              </h3>
              <div className="flex items-center gap-2 text-xs relative z-10">
                <span className={`inline-flex items-center font-bold px-2.5 py-1 rounded-xl bg-white/70 backdrop-blur-md shadow-sm ${item.isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {item.isPositive ? <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" /> : <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />}
                  {item.change}
                </span>
                <span className="text-slate-500 font-medium">{item.subtext}</span>
              </div>
            </div>
          );
        })}
      </section>

      {/* ======= CHARTS SECTION ========== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* 1 & 2: GROSS vs NET REVENUE COMPARISON */}
        <div className="lg:col-span-2 relative overflow-hidden rounded-3xl bg-gradient-to-tr from-white via-white/90 to-blue-200/60 backdrop-blur-xl border border-white/80 p-6 shadow-xl shadow-blue-500/10 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4 relative z-10">
            <div>
              <h3 className="text-lg font-bold text-slate-800">Gross vs. Net Revenue Breakdown</h3>
              <p className="text-xs text-slate-500">Comparing top-line totals against net retained revenue after discounts</p>
            </div>
          </div>

          <div className="h-72 w-full relative z-10">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueComparisonData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="day" stroke="#64748b" fontSize={12} tickLine={false} />
                <YAxis 
                  stroke="#64748b" 
                  fontSize={12} 
                  tickLine={false} 
                  tickFormatter={(val) => `₱${val / 1000}k`} 
                />
                <Tooltip 
                  formatter={(value) => [`₱${Number(value).toLocaleString()}`, '']}
                  contentStyle={{ 
                    backgroundColor: 'rgba(255, 255, 255, 0.9)', 
                    backdropFilter: 'blur(12px)',
                    borderRadius: '16px',
                    border: '1px solid rgba(255,255,255,0.8)',
                    boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)'
                  }} 
                />
                <Legend wrapperStyle={{ paddingTop: '10px' }} />
                <Bar dataKey="gross" name="Gross Revenue" fill="#2563eb" radius={[6, 6, 0, 0]} />
                <Bar dataKey="net" name="Net Revenue" fill="#10b981" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 3: CASH DRAWER VARIANCE AUDIT */}
        <div className="relative overflow-hidden rounded-3xl bg-[#0B132B] border border-blue-900/40 p-6 shadow-xl shadow-slate-950/20 flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-bold text-white">Register Variance Audit</h3>
            <p className="text-xs text-slate-400 mb-4">Shift reconciliation balance check</p>
          </div>

          {/* Shift Audit Log List — each cashier's short/over */}
          <div className="space-y-2 relative z-10 max-h-64 overflow-y-auto transparent-scrollbar">
            {registerVarianceData.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-2">No shift log data available</p>
            ) : (
              registerVarianceData.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs px-3 py-2 mb-1.5 last:mb-0 bg-slate-900/60 border border-slate-800/80 rounded-xl">
                  <div className="flex items-center gap-1.5">
                    {item.variance < 0 ? (
                      <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                    ) : item.variance > 0 ? (
                      <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    )}
                    <span className="font-bold text-white">{item.cashier || item.shift}</span>
                  </div>
                  <span className={`font-black ${item.variance < 0 ? 'text-rose-400' : item.variance > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {item.variance === 0 ? '₱0 (Balanced)' : `₱${item.variance}`}
                  </span>
                </div>
              ))
            )}
          </div>

        </div>

      </div>
    </div>
  );
}