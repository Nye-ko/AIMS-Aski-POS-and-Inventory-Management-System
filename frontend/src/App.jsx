import React, { useState } from 'react'
import { Menu } from 'lucide-react'
import { Routes, Route, Outlet} from 'react-router-dom'
import CashierPOS from './pages/cashierPOS'
import Login from './pages/ims/login'
import AdminDashboard  from './pages/ims/adminDashboard'
import InventoryList  from './pages/ims/inventoryList'
import Demand  from './pages/ims/demand'
import Finance  from './pages/ims/finance'
import SalesReport from './pages/ims/salesReport'
import UserManagement from './pages/ims/UserManagement'
import Sidebar from './pages/ims/sidebar'
import RequireAuth from './auth/RequireAuth'


function AppLayout (){
  const [navOpen, setNavOpen] = useState(false);
  return(
    <div className="custom-jakarta flex h-screen bg-gradient-to-br from-sky-100 via-blue-200 to-indigo-300 text-slate-800 font-sans relative overflow-hidden">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        
        .custom-jakarta, 
        .custom-jakarta input, 
        .custom-jakarta button, 
        .custom-jakarta label,
        .custom-jakarta span,
        .custom-jakarta div,
        .custom-jakarta h1,
        .custom-jakarta h2,
        .custom-jakarta h3,
        .custom-jakarta p {
          font-family: 'Plus Jakarta Sans', sans-serif !important;
        }

        .navy-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .navy-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
        }
        .navy-scrollbar::-webkit-scrollbar-thumb {
          background-color: rgba(255, 255, 255, 0.2);
          border-radius: 8px;
        }
        .navy-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: rgba(255, 255, 255, 0.4);
        }
      `}</style>

      <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-300 rounded-full blur-3xl opacity-60 pointer-events-none" />
      <div className="absolute top-1/2 -right-32 w-[500px] h-[500px] bg-indigo-300 rounded-full blur-3xl opacity-50 pointer-events-none" />
      <div className="absolute -bottom-32 left-1/3 w-96 h-96 bg-sky-200 rounded-full blur-3xl opacity-70 pointer-events-none" />

      {/* Shared Sidebar */}
      <Sidebar mobileOpen={navOpen} onMobileClose={() => setNavOpen(false)} />
      {navOpen && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm lg:hidden" onClick={() => setNavOpen(false)} aria-hidden="true" />
      )}

      {/* Main Container where page content changes */}
      <div className="flex-1 min-w-0 h-screen flex flex-col z-10">
        {/* Mobile / tablet top bar with the menu button */}
        <div className="lg:hidden flex items-center gap-3 px-3 sm:px-4 py-2.5 border-b border-white/60 bg-white/60 backdrop-blur-xl shrink-0">
          <button
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
            className="w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-700"
          >
            <Menu className="w-5 h-5" />
          </button>
          <img src="/aski.png" alt="Logo" className="h-9 w-auto shrink-0" />
          <div className="min-w-0 leading-tight">
            <p className="font-extrabold text-base tracking-tight text-blue-900">AMPC</p>
            <p className="text-[10px] tracking-widest text-indigo-500 uppercase font-semibold">Inventory</p>
          </div>
        </div>
        <main className="flex-1 min-w-0 flex flex-col p-3 sm:p-4 lg:p-6 overflow-y-auto overflow-x-hidden space-y-4 lg:space-y-6 [&>*]:shrink-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/pos" element={<RequireAuth roles={['CASHIER', 'SUPERVISOR']}><CashierPOS /></RequireAuth>} />
      <Route path="/" element={<Login />} />

      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route path="/adminDashboard" element={<RequireAuth roles={['SUPERVISOR', 'INVENTORY', 'ACCOUNTING']}><AdminDashboard /></RequireAuth>} />
        <Route path="/inventoryList" element={<RequireAuth roles={['SUPERVISOR', 'INVENTORY']}><InventoryList /></RequireAuth>} />
        <Route path="/pages/ims/demand" element={<RequireAuth roles={['INVENTORY', 'ACCOUNTING']}><Demand /></RequireAuth>} />
        <Route path="/pages/ims/finance" element={<RequireAuth roles={['ACCOUNTING']}><Finance /></RequireAuth>} />
        <Route path="/pages/ims/salesReport" element={<RequireAuth roles={['ACCOUNTING']}><SalesReport /></RequireAuth>} />
        <Route path="/pages/ims/UserManagement" element={<RequireAuth roles={[]}><UserManagement /></RequireAuth>} />
      </Route>
    </Routes>
  );
}