import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Home,
  Package,
  BrainCircuit,
  BarChart3,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Users,
  ShieldCheck,
  Eye,
  EyeOff,
  X,
  KeyRound,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import ChangePasswordModal from '../../auth/ChangePasswordModal';

function AdminAuthModal({ onClose, onVerified }) {
  const { verifyAdminPassword } = useAuth();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [shake, setShake] = useState(false);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 400);
  };

  const handleVerify = async () => {
    if (!password || isVerifying) return;
    setIsVerifying(true);
    setError(null);
    try {
      await verifyAdminPassword(password);
      onVerified();
    } catch (err) {
      setError(err.message || 'Invalid admin password. Access denied.');
      triggerShake();
    } finally {
      setIsVerifying(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <style>{`
        @keyframes adminAuthShake {
          10%, 90% { transform: translateX(-1px); }
          20%, 80% { transform: translateX(2px); }
          30%, 50%, 70% { transform: translateX(-4px); }
          40%, 60% { transform: translateX(4px); }
        }
        .admin-auth-shake { animation: adminAuthShake 0.4s ease-in-out; }
      `}</style>
      <div
        className={`bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-slate-200 overflow-hidden ${
          shake ? 'admin-auth-shake' : ''
        }`}
      >
        <div className="flex items-start justify-between gap-3 p-6 pb-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 shrink-0 rounded-xl bg-[#0B132B] flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Admin Verification Required</h3>
              <p className="text-xs text-slate-500 font-medium mt-1">
                Please enter your administrator password to access User Account Management.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pb-2">
          <label className="block text-[11px] font-bold text-slate-500 mb-1.5">Password</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              autoFocus
              placeholder="Enter your admin password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
              className="w-full rounded-xl bg-slate-50 border border-slate-200 pl-3 pr-10 py-2.5 text-sm font-semibold text-slate-800 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-400 transition-all"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {error && (
            <div className="mt-3 p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">
              {error}
            </div>
          )}
        </div>

        <div className="p-6 pt-4 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-full transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleVerify}
            disabled={!password || isVerifying}
            className="flex-1 py-2.5 bg-[#0B132B] hover:shadow-slate-900/30 shadow-lg text-white text-xs font-bold rounded-full transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {isVerifying ? 'Verifying…' : 'Verify & Access'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function Sidebar() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showAdminAuthModal, setShowAdminAuthModal] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, isAdminAuthenticated } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/', { replace: true });
  };

  // Mirrors the route guards in App.jsx (ADMIN sees everything).
  const allSidebarLinks = [
    { id: 'home', label: 'Home', icon: Home, path: '/adminDashboard', roles: ['SUPERVISOR', 'INVENTORY', 'ACCOUNTING'] },
    { id: 'inventory', label: 'Inventory', icon: Package, path: '/inventoryList', roles: ['SUPERVISOR', 'INVENTORY'] },
    { id: 'forecasting', label: 'Forecasting', icon: BrainCircuit, path: '/pages/ims/demand', roles: ['INVENTORY', 'ACCOUNTING'] },
    { id: 'finance', label: 'Finance', icon: BarChart3, path: '/pages/ims/finance', roles: ['ACCOUNTING'] },
    { id: 'users', label: 'User Management', icon: Users, path: '/pages/ims/UserManagement', roles: [] },
  ];
  const sidebarLinks = allSidebarLinks.filter(
    (item) => user?.role === 'ADMIN' || item.roles.includes(user?.role)
  );

  const handleNavClick = (item) => {
    if (item.id === 'users' && !isAdminAuthenticated) {
      setShowAdminAuthModal(true);
      return;
    }
    navigate(item.path);
  };

  return (
    <aside 
      className={`relative z-20 m-4 mr-0 flex flex-col rounded-3xl bg-white/30 backdrop-blur-xl border border-white/60 shadow-xl shadow-blue-500/5 transition-all duration-300 ${
        isSidebarCollapsed ? 'w-20' : 'w-64'
      }`}
    >
      <button
        onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        className="absolute -right-3.5 top-8 w-7 h-7 bg-white/80 border border-white shadow-md backdrop-blur-md rounded-full flex items-center justify-center text-slate-700 hover:text-blue-600 transition z-30"
      >
        {isSidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>

      <div className={`p-5 flex items-center border-b border-white/40 ${isSidebarCollapsed ? 'justify-center' : 'gap-3'}`}>
        <div className="w-20 h-10 shrink-0">
          <img src="/aski.png" alt="Logo" />
        </div>
        {!isSidebarCollapsed && (
          <div className="overflow-hidden">
            <h1 className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-blue-900 to-indigo-800 bg-clip-text text-transparent whitespace-nowrap">
              AMPC
            </h1>
            <p className="text-[10px] tracking-widest text-blue-700/70 uppercase font-semibold whitespace-nowrap">
              Inventory
            </p>
          </div>
        )}
      </div>

      <nav className="flex-1 px-3 py-6 space-y-2">
        {sidebarLinks.map((item) => {
          const Icon = item.icon;
          
          // Check active route matching current URL path
          const isActive = location.pathname === item.path;

          return (
            <button
              key={item.id}
              onClick={() => handleNavClick(item)}
              title={isSidebarCollapsed ? item.label : undefined}
              className={`w-full flex items-center gap-3.5 px-3.5 py-3 rounded-2xl text-sm font-medium transition-all duration-300 relative ${
                isActive
                  ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-lg shadow-blue-500/30 font-semibold'
                  : 'text-slate-700 hover:bg-white/40 hover:text-blue-900'
              } ${isSidebarCollapsed ? 'justify-center' : ''}`}
            >
              <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-white' : 'text-slate-600'}`} />
              {!isSidebarCollapsed && <span className="truncate">{item.label}</span>}
              {isActive && !isSidebarCollapsed && (
                <span className="absolute right-3 w-2 h-2 rounded-full bg-white shadow-sm animate-pulse" />
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-white/40 space-y-2">
        <div className={`flex items-center gap-3 p-2 rounded-2xl bg-white/20 border border-white/40 ${isSidebarCollapsed ? 'justify-center' : ''}`}>
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 border border-white flex items-center justify-center font-bold text-white text-xs shrink-0 shadow-sm">
            {(user?.username?.[0] || '?').toUpperCase()}
          </div>
          {!isSidebarCollapsed && (
            <div className="truncate">
              <p className="text-xs font-bold text-slate-800 truncate">{user?.username || 'Guest'}</p>
              <p className="text-xs text-slate-600 font-medium truncate">{user?.role || '—'}</p>
            </div>
          )}
        </div>

        <div className={`flex gap-1.5 ${isSidebarCollapsed ? 'flex-col items-center' : 'flex-row'}`}>
          <button
            onClick={() => setShowChangePassword(true)}
            title="Change password"
            className="flex items-center justify-center gap-2.5 px-3 py-2.5 rounded-2xl text-xs font-semibold text-slate-700 bg-white/40 border border-white/60 hover:bg-white/70 transition-all"
          >
            <KeyRound className="w-4 h-4 text-slate-600 shrink-0" />
            {!isSidebarCollapsed && <span>Password</span>}
          </button>
          <button
            onClick={handleLogout}
            className="flex-1 flex items-center justify-center gap-2.5 px-3 py-2.5 rounded-2xl text-xs font-semibold text-rose-700 bg-rose-500/10 border border-rose-200/50 hover:bg-rose-500/20 transition-all"
          >
            <LogOut className="w-4 h-4 text-rose-600 shrink-0" />
            {!isSidebarCollapsed && <span>Logout</span>}
          </button>
        </div>
      </div>

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}

      {showAdminAuthModal && (
        <AdminAuthModal
          onClose={() => setShowAdminAuthModal(false)}
          onVerified={() => {
            setShowAdminAuthModal(false);
            navigate('/pages/ims/UserManagement');
          }}
        />
      )}
    </aside>
  );
}