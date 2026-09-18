import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Home,
  Package,
  BrainCircuit,
  BarChart3,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';

export default function Sidebar() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/', { replace: true });
  };

  const sidebarLinks = [
    { id: 'home', label: 'Home', icon: Home, path: '/adminDashboard' },
    { id: 'inventory', label: 'Inventory', icon: Package, path: '/inventoryList' },
    { id: 'forecasting', label: 'Forecasting', icon: BrainCircuit, path: '/pages/ims/demand' },
    { id: 'finance', label: 'Finance', icon: BarChart3, path: '/pages/ims/finance' },
  ];

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
              onClick={() => navigate(item.path)} // Use React Router navigate
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
            onClick={handleLogout}
            className="flex-1 flex items-center justify-center gap-2.5 px-3 py-2.5 rounded-2xl text-xs font-semibold text-rose-700 bg-rose-500/10 border border-rose-200/50 hover:bg-rose-500/20 transition-all"
          >
            <LogOut className="w-4 h-4 text-rose-600 shrink-0" />
            {!isSidebarCollapsed && <span>Logout</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}