import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Home,
  Settings,
  LogOut,
  Bell,
  Image as ImageIcon
} from 'lucide-react';
import {
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

// --- DATA DEFINITIONS ---

// 1. Daily Revenue Line Chart Data
const dailyRevenueData = [
  { day: '1', line1: 25000, line2: 10000, line3: 3000 },
  { day: '2', line1: 24000, line2: 12000, line3: 11000 },
  { day: '3', line1: 47000, line2: 30000, line3: 11000 },
  { day: '4', line1: 31000, line2: 22500, line3: 5000 },
  { day: '5', line1: 36000, line2: 30000, line3: 16000 },
  { day: '6', line1: 28000, line2: 13000, line3: 9000 },
  { day: '8', line1: 38000, line2: 19000, line3: 4000 },
];

// 2. Monthly Revenue Line Chart Data
const monthlyRevenueData = [
  { month: '1', line1: 530000, line2: 470000, line3: 470000 },
  { month: '2', line1: 630000, line2: 600000, line3: 460000 },
  { month: '3', line1: 390000, line2: 220000, line3: 9000 },
  { month: '4', line1: 760000, line2: 580000, line3: 160000 },
  { month: '5', line1: 490000, line2: 30000, line3: 40000 },
  { month: '6', line1: 490000, line2: 380000, line3: 90000 },
  { month: '7', line1: 960000, line2: 760000, line3: 340000 },
  { month: '8', line1: 320000, line2: 120000, line3: 30000 },
  { month: '9', line1: 760000, line2: 730000, line3: 480000 },
  { month: '10', line1: 660000, line2: 630000, line3: 480000 },
  { month: '11', line1: 750000, line2: 660000, line3: 320000 },
  { month: '12', line1: 700000, line2: 630000, line3: 240000 },
];

// 3. Inventory Balance Donut Chart Data
const inventoryBalanceData = [
  { name: 'C1', value: 800 },
  { name: 'C2', value: 600 },
  { name: 'C3', value: 300 },
  { name: 'C4', value: 700 },
  { name: 'C5', value: 450 },
  { name: 'C6', value: 500 },
  { name: 'C7', value: 220 },
  { name: 'C8', value: 650 },
  { name: 'C9', value: 380 },
  { name: 'C10', value: 420 },
  { name: 'C11', value: 300 },
  { name: 'C12', value: 348 },
];

// Monochrome grayscale palette matching the design
const GREY_COLORS = [
  '#2C302E', '#434A47', '#59635F', '#707C77', 
  '#87958F', '#9EAFA7', '#B5C8BF', '#626868', 
  '#7A8181', '#939A9A', '#ACB3B3', '#C5CCCC'
];

export default function Login() {
  const navigate = useNavigate();

  const handleLogin = (e) => {
    e.preventDefault();
    navigate('/adminDashboard');
  };

  return (

  <div>
      {/*  font import*/}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        
        .custom-jakarta, 
        .custom-jakarta input, 
        .custom-jakarta button, 
        .custom-jakarta label {
          font-family: 'Plus Jakarta Sans', sans-serif !important;
        }
      `}</style>

      <div 
        className="custom-jakarta min-h-screen flex items-center justify-center antialiased bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url('/blue-bg2.jpg')` }}
      >
        {/* Glassmorphism Container */}
        <div className="w-full max-w-md mx-4 p-8 rounded-3xl bg-white/30 backdrop-blur-xl border border-white/100 shadow-2xl transition-all duration-500 hover:shadow-[0_0_40px_rgba(56,189,248,0.5)] hover:border-white/100 hover:bg-white/35">
          
          <div className="flex justify-center mb-4">
            <img 
                src="/aski.png" 
                alt="Logo" 
                className="w-48 h-auto sm:w-64 object-contain rounded-2xl drop-shadow-md transition-all duration-300"
            />
        </div>

          {/* Title */}
          <h1 className="text-3xl font-bold text-black-800 text-center mb-8 tracking-tight">
            AMPC Inventory
          </h1>

          {/* Form */}
          <form className="space-y-5" onSubmit={handleLogin}>
            
            {/* Username */}
            <div>
            <label htmlFor="username" className="block text-sm font-semibold text-slate-700 mb-1.5">
                Username
            </label>
            <input 
                type="text" 
                id="username" 
                name="username" 
                required 
                placeholder="Enter your username"
                className="w-full px-4 py-3 rounded-xl bg-white/25 backdrop-blur-md border border-white/60 text-slate-800 placeholder-slate-500/80 shadow-[inset_0_1px_2px_rgba(255,255,255,0.6),0_4px_12px_rgba(0,0,0,0.05)] focus:outline-none focus:ring-2 focus:ring-white/80 focus:bg-white/40 focus:border-white transition-all duration-200"
            />
            </div>

            {/* Password */}
            <div>
            <label htmlFor="password" className="block text-sm font-semibold text-slate-700 mb-1.5">
                Password
            </label>
            <input 
                type="password" 
                id="password" 
                name="password" 
                required 
                placeholder="Enter your password"
                className="w-full px-4 py-3 rounded-xl bg-white/25 backdrop-blur-md border border-white/60 text-slate-800 placeholder-slate-500/80 shadow-[inset_0_1px_2px_rgba(255,255,255,0.6),0_4px_12px_rgba(0,0,0,0.05)] focus:outline-none focus:ring-2 focus:ring-white/80 focus:bg-white/40 focus:border-white transition-all duration-200"
            />
            </div>

            <div className="pt-6">
            {/*Glass Button */}
            <button 
              type="submit" 
              className="w-full py-3.5 mt-2 rounded-full flex items-center justify-center text-slate-900 font-bold tracking-wide border border-white/80 backdrop-blur-md shadow-[inset_0_2px_4px_rgba(255,255,255,0.8),inset_0_-2px_4px_rgba(0,0,0,0.1),0_8px_20px_rgba(56,189,248,0.35)] transition-all duration-300 hover:shadow-[inset_0_2px_6px_rgba(255,255,255,1),0_12px_28px_rgba(56,189,248,0.5)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] bg-gradient-to-r from-sky-200 via-sky-300 to-blue-400"
            >
              Log in
            </button>
            </div>

          </form>
        </div>
      </div>
    </div>
    
  );
}