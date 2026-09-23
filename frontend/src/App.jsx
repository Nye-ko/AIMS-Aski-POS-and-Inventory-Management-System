import React from 'react'
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
  return(
    <div className="custom-jakarta min-h-screen flex bg-gradient-to-br from-sky-100 via-blue-200 to-indigo-300 text-slate-800 font-sans relative overflow-hidden">
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
          background: rgba(255, 255, 255, 0.2);
          border-radius: 8px;
        }
        .navy-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.4);
        }
      `}</style>

      <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-300 rounded-full blur-3xl opacity-60 pointer-events-none" />
      <div className="absolute top-1/2 -right-32 w-[500px] h-[500px] bg-indigo-300 rounded-full blur-3xl opacity-50 pointer-events-none" />
      <div className="absolute -bottom-32 left-1/3 w-96 h-96 bg-sky-200 rounded-full blur-3xl opacity-70 pointer-events-none" />

      {/* Shared Sidebar */}
      <Sidebar />

      {/* Main Container where page content changes */}
      <main className="flex-1 flex flex-col p-6 overflow-y-auto space-y-6 z-10">
        <Outlet />
      </main>
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