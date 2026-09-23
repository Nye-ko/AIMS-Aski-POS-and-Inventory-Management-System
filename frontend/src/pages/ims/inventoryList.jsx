import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { io } from 'socket.io-client';
import {
  Package,
  Plus,
  FileSpreadsheet,
  RotateCcw,
  Truck,
  Search,
  ChevronDown,
  X,
  BarChart3,
  PackagePlus,
  Barcode,
  Loader2,
  Check,
  LayoutGrid,
  History, SlidersHorizontal, Inbox,
  Users, Star, Scale, AlertTriangle, CheckCircle2
} from 'lucide-react';
import { CategoryIcon } from '../../utils/CategoryIcon';
import PurchaseOrdersList from './PurchaseOrdersList';
import ReceivingReportModal from './ReceivingReportModal';
import PurchaseReturnModal from './PurchaseReturnModal';
import StockHistoryModal from './StockHistoryModal';
import AdjustStockModal from './AdjustStockModal';

import { apiFetch, getAuthToken } from '../../auth/apiFetch';
import { useAuth } from '../../auth/AuthContext';
import { buildInventorySheets } from '../../utils/inventorySheets';
import { exportToExcel } from '../../utils/exportExcel';

const API_BASE_URL = 'http://localhost:5000/api';
const SOCKET_SERVER_URL = 'http://localhost:5000';

// Surface the server's own error message (e.g. "Barcode ... is already used by ...") instead of a bare status.
const throwApiError = async (response) => {
  const body = await response.json().catch(() => ({}));
  throw new Error(body.error || `HTTP error status ${response.status}`);
};

// Helper function to handle property name mismatches from the backend
const getStockValue = (product) => {
  if (!product) return 0;
  return Number(product.currentStock ?? product.stock ?? product.quantity ?? 0);
};

export default function InventorySystem() {
  const [activeTab, setActiveTab] = useState('inventory');
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchInitialData();
  }, []);

  // Live stock updates (sales, receiving reports, purchase returns, manual add/adjust) — patches
  // the affected rows in place, or appends a brand-new product (e.g. created via a receiving
  // report), so the list stays current without the user needing to refresh.
  useEffect(() => {
    const socket = io(SOCKET_SERVER_URL, { auth: { token: getAuthToken() } });
    socket.on('stock_updated', ({ products: changedProducts }) => {
      if (!Array.isArray(changedProducts) || changedProducts.length === 0) return;
      setProducts((prev) => {
        const byId = new Map(prev.map((p) => [p.id, p]));
        for (const p of changedProducts) byId.set(p.id, p);
        return [...byId.values()];
      });
    });
    return () => socket.disconnect();
  }, []);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const [productsRes, suppliersRes] = await Promise.all([
        apiFetch(`${API_BASE_URL}/products`),
        apiFetch(`${API_BASE_URL}/suppliers`)
      ]);

      if (!productsRes.ok) throw new Error(`Products endpoint returned status ${productsRes.status}`);
      if (!suppliersRes.ok) throw new Error(`Suppliers endpoint returned status ${suppliersRes.status}`);

      const productsData = await productsRes.json();
      const suppliersData = await suppliersRes.json();

      setProducts(productsData);
      setSuppliers(suppliersData);
      setError(null);
    } catch (err) {
      console.error("Database fetch error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-600 font-bold text-sm">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          <span>Connecting to database...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="bg-gradient-to-br from-white via-white/90 to-blue-200/60 backdrop-blur-xl border border-white/80 p-6 rounded-3xl shadow-xl shadow-blue-500/10 max-w-md text-center">
          <p className="text-rose-600 font-bold text-sm mb-2">Database Connection Error</p>
          <p className="text-slate-500 text-xs mb-4">{error}</p>
          <button
            onClick={fetchInitialData}
            className="px-4 py-2 bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-xs rounded-full shadow-md hover:shadow-lg hover:shadow-blue-500/30 transition-all cursor-pointer"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ===== HEADER ====== */}
      <header className="relative z-30 flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-white via-white/90 to-blue-200/60 backdrop-blur-xl border border-white/80 rounded-3xl px-8 py-4 shadow-xl shadow-blue-500/10">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/30">
            <Package className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-blue-600">AMPC</p>
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">INVENTORY MANAGEMENT</h2>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-white/60 backdrop-blur-sm p-1.5 rounded-2xl border border-white/70">
          <button
            onClick={() => setActiveTab('inventory')}
            className={`flex items-center gap-2 px-4 py-2 font-bold text-xs rounded-xl transition-all cursor-pointer ${
              activeTab === 'inventory'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Package className="w-4 h-4" />
            <span>Inventory List</span>
          </button>

          <button
            onClick={() => setActiveTab('reports')}
            className={`flex items-center gap-2 px-4 py-2 font-bold text-xs rounded-xl transition-all cursor-pointer ${
              activeTab === 'reports'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Supplier Reports</span>
          </button>

          <button
            onClick={() => setActiveTab('ledger')}
            className={`flex items-center gap-2 px-4 py-2 font-bold text-xs rounded-xl transition-all cursor-pointer ${
              activeTab === 'ledger'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Ledger / History</span>
          </button>

          <button
            onClick={() => setActiveTab('members')}
            className={`flex items-center gap-2 px-4 py-2 font-bold text-xs rounded-xl transition-all cursor-pointer ${
              activeTab === 'members'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Members</span>
          </button>

          <button
            onClick={() => setActiveTab('reconciliation')}
            className={`flex items-center gap-2 px-4 py-2 font-bold text-xs rounded-xl transition-all cursor-pointer ${
              activeTab === 'reconciliation'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Scale className="w-4 h-4" />
            <span>Reconciliation</span>
          </button>
        </div>
      </header>

      <div className="mt-6">
        {activeTab === 'inventory' && (
          <InventoryPage
            products={products}
            setProducts={setProducts}
            suppliers={suppliers}
            exportToExcel={exportToExcel}
            onDataChanged={fetchInitialData}
          />
        )}

        {activeTab === 'reports' && (
          <ReportsPage
            products={products}
            setProducts={setProducts}
            suppliers={suppliers}
            exportToExcel={exportToExcel}
          />
        )}

        {activeTab === 'ledger' && <LedgerReportPage exportToExcel={exportToExcel} />}

        {activeTab === 'members' && <MembersPage />}

        {activeTab === 'reconciliation' && <ReconciliationPage exportToExcel={exportToExcel} />}
      </div>
    </>
  );
}

// Uniform, neutral outline-style button used for the secondary toolbar
// actions — a colored icon carries the meaning while the button chrome
// stays consistent, so the row reads as one cohesive group instead of a
// mismatched set of pastel pills.
function ToolbarButton({ icon: Icon, iconColor, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200/80 text-slate-600 font-semibold text-xs rounded-xl hover:border-indigo-200 hover:bg-slate-50 hover:text-slate-900 transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer"
    >
      <Icon className={`w-4 h-4 ${iconColor}`} />
      <span>{label}</span>
    </button>
  );
}

// ==========================================
// INVENTORY PAGE COMPONENT
// ==========================================
function InventoryPage({ products, setProducts, suppliers, exportToExcel, onDataChanged }) {
  // Supervisors can browse and export inventory but not change it (matches the backend role guards).
  const { role } = useAuth();
  const canWrite = role === 'ADMIN' || role === 'INVENTORY';
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isAddStockOpen, setIsAddStockOpen] = useState(false);
  const [historyProduct, setHistoryProduct] = useState(null);
  const [adjustProduct, setAdjustProduct] = useState(null);
  const [isPurchaseOrderOpen, setIsPurchaseOrderOpen] = useState(false);
  const [isReceivingReportOpen, setIsReceivingReportOpen] = useState(false);
  const [isPurchaseReturnOpen, setIsPurchaseReturnOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const categoryMenuRef = useRef(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Close the category dropdown when clicking outside of it
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (categoryMenuRef.current && !categoryMenuRef.current.contains(e.target)) {
        setCategoryMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Supplier / category dropdowns inside the "Add Product" form
  const [productSupplierMenuOpen, setProductSupplierMenuOpen] = useState(false);
  const productSupplierMenuRef = useRef(null);
  const [productCategoryMenuOpen, setProductCategoryMenuOpen] = useState(false);
  const productCategoryMenuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (productSupplierMenuRef.current && !productSupplierMenuRef.current.contains(e.target)) {
        setProductSupplierMenuOpen(false);
      }
      if (productCategoryMenuRef.current && !productCategoryMenuRef.current.contains(e.target)) {
        setProductCategoryMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [formData, setFormData] = useState({
    barcode: '',
    name: '',
    supplierId: '',
    category: '',
    currentStock: '',
    minStock: '',
    unitCost: '',
    sellingPrice: ''
  });

  const [stockSearchQuery, setStockSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [stockSupplierId, setStockSupplierId] = useState('');
  const [addQty, setAddQty] = useState('');

  const productSuggestions = useMemo(() => {
    if (!stockSearchQuery.trim() || selectedProduct) return [];
    const query = stockSearchQuery.toLowerCase();
    return products.filter(p => 
      p.name?.toLowerCase().includes(query) || 
      p.barcode?.toLowerCase().includes(query)
    ).slice(0, 5);
  }, [products, stockSearchQuery, selectedProduct]);

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleClearForm = () => {
    setFormData({ barcode: '', name: '', supplierId: '', category: '', currentStock: '', minStock: '', unitCost: '', sellingPrice: '' });
  };

  const handleAddProduct = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.supplierId) {
      alert("Please fill in Product Name and select a Supplier.");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        barcode: formData.barcode || String(Math.floor(1000000000 + Math.random() * 9000000000)),
        name: formData.name,
        category: formData.category || 'Uncategorized',
        currentStock: Number(formData.currentStock) || 0,
        minStock: Number(formData.minStock) || 10,
        unitCost: Number(formData.unitCost) || 0,
        sellingPrice: Number(formData.sellingPrice) || 0,
        supplierId: Number(formData.supplierId)
      };

      const response = await apiFetch(`${API_BASE_URL}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) await throwApiError(response);

      const savedProduct = await response.json();

      setProducts(prev => [savedProduct, ...prev]);
      setFormData({ barcode: '', name: '', supplierId: '', category: '', currentStock: '', minStock: '', unitCost: '', sellingPrice: '' });
      setIsFormOpen(false);
    } catch (err) {
      alert(`Error saving product: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelectSuggestion = (product) => {
    setSelectedProduct(product);
    setStockSearchQuery(`[${product.barcode}] ${product.name}`);
    setStockSupplierId(String(product.supplierId || ''));
  };

  const resetStockForm = () => {
    setStockSearchQuery('');
    setSelectedProduct(null);
    setStockSupplierId('');
    setAddQty('');
  };

  const handleAddStockSubmit = async (e) => {
    e.preventDefault();
    if (!selectedProduct || !stockSupplierId || !addQty) {
      alert("Please select a valid product, supplier, and enter stock quantity.");
      return;
    }

    const addedQtyNum = Number(addQty);
    if (addedQtyNum <= 0) {
      alert("Please enter a valid stock quantity.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await apiFetch(`${API_BASE_URL}/products/${selectedProduct.id}/add-stock`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quantity: addedQtyNum,
          supplierId: Number(stockSupplierId)
        })
      });

      if (!response.ok) await throwApiError(response);

      const updatedProduct = await response.json();

      setProducts(prev => prev.map(p => p.id === updatedProduct.id ? updatedProduct : p));
      resetStockForm();
      setIsAddStockOpen(false);
      alert("Stock added successfully!");
    } catch (err) {
      alert(`Error updating stock: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort(),
    [products]
  );

  const filteredProducts = products.filter(p => {
    const matchesSearch =
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.barcode?.toLowerCase().includes(search.toLowerCase()) ||
      p.supplierName?.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Every product (the on-screen search/category filter is ignored) goes into the file: an "All Products" sheet,
  // then one sheet per category. Product IDs are internal, so they are not exported.
  const handleExportInventorySheet = () => {
    const rows = products.map((p) => {
      const stock = getStockValue(p);
      return {
        'Barcode': p.barcode,
        'Product Name': p.name,
        'Supplier': p.supplierName || 'N/A',
        'Category': p.category,
        'Current Stock': stock,
        'Unit Cost (₱)': Number(p.unitCost || 0).toFixed(2),
        'Selling Price (₱)': Number(p.sellingPrice || 0).toFixed(2),
        'Batch Date': p.batchDate,
        'Status': p.status || (stock > 10 ? 'In Stock' : stock > 0 ? 'Low Stock' : 'Out of Stock')
      };
    });
    exportToExcel(rows, 'Inventory_Sheet', buildInventorySheets(rows));
  };

  return (
    <div className="space-y-6">
      <div className="relative overflow-visible bg-white border border-slate-200/80 rounded-3xl shadow-sm p-5 space-y-4">
        {/* Row 1: utility actions — uniform neutral toolbar buttons (they wrap as a group) */}
        <div className="relative z-10 flex flex-wrap items-center gap-2">
          <ToolbarButton icon={FileSpreadsheet} iconColor="text-emerald-600" label="Export Inventory Sheet" onClick={handleExportInventorySheet} />
          {canWrite && (
            <>
              <ToolbarButton
                icon={PackagePlus}
                iconColor="text-indigo-600"
                label="Add Stock"
                onClick={() => {
                  setIsAddStockOpen(true);
                  setIsFormOpen(false);
                  resetStockForm();
                }}
              />
              <ToolbarButton icon={FileSpreadsheet} iconColor="text-amber-600" label="Create Purchase Order" onClick={() => setIsPurchaseOrderOpen(true)} />
              <ToolbarButton icon={Truck} iconColor="text-teal-600" label="Create Receiving Report" onClick={() => setIsReceivingReportOpen(true)} />
              <ToolbarButton icon={RotateCcw} iconColor="text-rose-600" label="Create Purchase Return" onClick={() => setIsPurchaseReturnOpen(true)} />
            </>
          )}
        </div>

        <div className="relative z-10 border-t border-slate-100" />

        {/* Row 2: search + category filter — z-20 so its dropdown (which
            visually overflows into the card below) always wins the stacking
            tie against the Product List card's own z-10 header/table rows */}
        <div className="relative z-20 flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="relative w-full sm:max-w-sm">
            <Search className="w-4 h-4 text-blue-500 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search barcode, product or supplier..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white border border-slate-200/80 shadow-sm rounded-full pl-9 pr-4 py-2.5 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
            />
          </div>

          {/* Custom dropdown with category icons — matches cashierPOS.jsx's category filter */}
          <div className="relative" ref={categoryMenuRef}>
            <button
              type="button"
              onClick={() => setCategoryMenuOpen((o) => !o)}
              className="flex items-center gap-2 bg-white border border-slate-200/80 shadow-sm text-slate-600 pl-3 pr-3 py-2.5 rounded-full text-xs font-semibold hover:border-blue-300 transition-colors cursor-pointer"
            >
              {selectedCategory === 'All' ? (
                <LayoutGrid className="w-3.5 h-3.5 text-blue-500" />
              ) : (
                <CategoryIcon category={selectedCategory} className="w-3.5 h-3.5 text-blue-500" />
              )}
              {selectedCategory === 'All' ? 'All Categories' : selectedCategory}
              <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${categoryMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {categoryMenuOpen && (
              <div className="absolute top-full left-0 mt-2 min-w-[200px] w-max max-w-xs bg-white border border-slate-200 rounded-xl shadow-xl z-30 py-1.5 max-h-64 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => { setSelectedCategory('All'); setCategoryMenuOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${selectedCategory === 'All' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span className="flex-1 text-left">All Categories</span>
                  {selectedCategory === 'All' && <Check className="w-3.5 h-3.5" />}
                </button>
                {categories.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-400">No categories yet</p>
                ) : (
                  categories.map((cat) => {
                    const active = selectedCategory === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => { setSelectedCategory(cat); setCategoryMenuOpen(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${active ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}
                      >
                        <CategoryIcon category={cat} className="w-3.5 h-3.5" />
                        <span className="flex-1 text-left">{cat}</span>
                        {active && <Check className="w-3.5 h-3.5" />}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {canWrite && <button
            onClick={() => {
              setIsFormOpen(!isFormOpen);
              setIsAddStockOpen(false);
            }}
            className={`sm:ml-auto flex shrink-0 items-center justify-center gap-2 px-4 py-2 font-bold text-xs rounded-full transition-all cursor-pointer ${
              isFormOpen
                ? 'bg-white text-slate-600 border border-slate-200/80 hover:bg-slate-50'
                : 'bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/30 hover:shadow-lg hover:shadow-blue-500/40'
            }`}
          >
            {isFormOpen ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            <span>{isFormOpen ? 'Close Form' : 'Add Product'}</span>
          </button>}
        </div>
      </div>

      {/* ADD NEW PRODUCT FORM */}
      {isFormOpen && (
        <div className="relative overflow-hidden bg-[#0B132B] border border-slate-800 p-6 rounded-2xl shadow-2xl shadow-slate-950/40 animate-fadeIn">
          <div className="absolute top-0 right-0 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
          <form onSubmit={handleAddProduct} className="relative z-10">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider">Product Details</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClearForm}
                  className="px-4 py-2 bg-slate-800/80 border border-slate-700 hover:bg-slate-700 text-slate-200 font-semibold text-xs rounded-xl transition-all cursor-pointer"
                >
                  Clear
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20 font-semibold text-xs rounded-xl transition-all disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? 'Saving...' : 'Add Product'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Barcode</label>
                <input type="text" name="barcode" value={formData.barcode} onChange={handleInputChange} placeholder="Auto-generated if blank" className="w-full bg-slate-900/90 border border-slate-700/80 text-white rounded-xl px-4 py-2.5 text-xs placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all [color-scheme:dark]" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Product Name</label>
                <input type="text" name="name" value={formData.name} onChange={handleInputChange} placeholder="e.g., Whole Milk 1L" className="w-full bg-slate-900/90 border border-slate-700/80 text-white rounded-xl px-4 py-2.5 text-xs placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all [color-scheme:dark]" required />
              </div>

              {/* Supplier — custom dark dropdown */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Supplier</label>
                <div className="relative" ref={productSupplierMenuRef}>
                  <button
                    type="button"
                    onClick={() => setProductSupplierMenuOpen((o) => !o)}
                    className="w-full flex items-center justify-between gap-2 bg-slate-900 border border-slate-700 text-slate-200 rounded-xl px-4 py-2.5 text-xs shadow-sm hover:border-blue-500/60 transition-all cursor-pointer"
                  >
                    <span className={`truncate ${formData.supplierId ? 'text-slate-200' : 'text-slate-500'}`}>
                      {suppliers.find((s) => String(s.id) === String(formData.supplierId))?.name || 'Select Supplier'}
                    </span>
                    <ChevronDown className={`w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform ${productSupplierMenuOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {productSupplierMenuOpen && (
                    <div className="absolute top-full left-0 mt-2 w-full min-w-[180px] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-30 py-1.5 max-h-52 overflow-y-auto">
                      {suppliers.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-slate-500">No suppliers yet</p>
                      ) : (
                        suppliers.map((s) => {
                          const active = String(formData.supplierId) === String(s.id);
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                setFormData((prev) => ({ ...prev, supplierId: String(s.id) }));
                                setProductSupplierMenuOpen(false);
                              }}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${active ? 'bg-blue-500/10 text-blue-400' : 'text-slate-300 hover:bg-slate-800'}`}
                            >
                              <span className="flex-1 text-left truncate">{s.name}</span>
                              {active && <Check className="w-3.5 h-3.5" />}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Category — custom dark dropdown with icons, plus a free-text fallback for new categories */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Category</label>
                <div className="relative" ref={productCategoryMenuRef}>
                  <button
                    type="button"
                    onClick={() => setProductCategoryMenuOpen((o) => !o)}
                    className="w-full flex items-center justify-between gap-2 bg-slate-900 border border-slate-700 text-slate-200 rounded-xl px-4 py-2.5 text-xs shadow-sm hover:border-blue-500/60 transition-all cursor-pointer"
                  >
                    <span className={`flex items-center gap-2 truncate ${formData.category ? 'text-slate-200' : 'text-slate-500'}`}>
                      {formData.category && <CategoryIcon category={formData.category} className="w-3.5 h-3.5 text-blue-400 shrink-0" />}
                      {formData.category || 'Select Category'}
                    </span>
                    <ChevronDown className={`w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform ${productCategoryMenuOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {productCategoryMenuOpen && (
                    <div className="absolute top-full left-0 mt-2 w-full min-w-[200px] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-30 py-1.5 max-h-52 overflow-y-auto">
                      {categories.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-slate-500">No categories yet</p>
                      ) : (
                        categories.map((cat) => {
                          const active = formData.category === cat;
                          return (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => {
                                setFormData((prev) => ({ ...prev, category: cat }));
                                setProductCategoryMenuOpen(false);
                              }}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${active ? 'bg-blue-500/10 text-blue-400' : 'text-slate-300 hover:bg-slate-800'}`}
                            >
                              <CategoryIcon category={cat} className="w-3.5 h-3.5" />
                              <span className="flex-1 text-left truncate">{cat}</span>
                              {active && <Check className="w-3.5 h-3.5" />}
                            </button>
                          );
                        })
                      )}
                      <div className="border-t border-slate-800 mt-1 pt-1.5 px-1.5">
                        <input
                          type="text"
                          name="category"
                          value={formData.category}
                          onChange={handleInputChange}
                          placeholder="Or type a new category..."
                          className="w-full bg-slate-950/60 border border-slate-800 text-white rounded-lg px-2.5 py-1.5 text-xs placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Initial Stock Quantity</label>
                <input type="number" name="currentStock" value={formData.currentStock} onChange={handleInputChange} placeholder="e.g., 50" className="w-full bg-slate-900/90 border border-slate-700/80 text-white rounded-xl px-4 py-2.5 text-xs placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all [color-scheme:dark]" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Min Stock (Alert Threshold)</label>
                <input type="number" name="minStock" value={formData.minStock} onChange={handleInputChange} placeholder="Defaults to 10" className="w-full bg-slate-900/90 border border-slate-700/80 text-white rounded-xl px-4 py-2.5 text-xs placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all [color-scheme:dark]" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Unit Cost (₱)</label>
                <input type="number" name="unitCost" value={formData.unitCost} onChange={handleInputChange} placeholder="0.00" className="w-full bg-slate-900/90 border border-slate-700/80 text-white rounded-xl px-4 py-2.5 text-xs placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all [color-scheme:dark]" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Selling Price (₱)</label>
                <input type="number" name="sellingPrice" value={formData.sellingPrice} onChange={handleInputChange} placeholder="0.00" className="w-full bg-slate-900/90 border border-slate-700/80 text-white rounded-xl px-4 py-2.5 text-xs placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all [color-scheme:dark]" />
              </div>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: ADD STOCK — rendered via portal so the backdrop covers the sidebar too */}
      {isAddStockOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-modal-backdrop">
          <div className="font-sans bg-white rounded-2xl p-6 shadow-2xl shadow-slate-900/10 max-w-md w-full border border-slate-200/80 animate-modal-card">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <PackagePlus className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Add Stock Quantity</h3>
              </div>
              <button onClick={() => setIsAddStockOpen(false)} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-full transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddStockSubmit} className="space-y-4">
              <div className="relative">
                <label className="block text-xs font-bold text-slate-700 mb-1">Product Barcode or Name</label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Type barcode or product name..."
                    value={stockSearchQuery}
                    onChange={(e) => {
                      setStockSearchQuery(e.target.value);
                      if (selectedProduct) setSelectedProduct(null);
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-8 py-2.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                  <Barcode className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  {stockSearchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setStockSearchQuery('');
                        setSelectedProduct(null);
                      }}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {productSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-10 max-h-48 overflow-y-auto divide-y divide-slate-100">
                    {productSuggestions.map(p => (
                      <div
                        key={p.id}
                        onClick={() => handleSelectSuggestion(p)}
                        className="p-2.5 hover:bg-blue-50/50 cursor-pointer transition flex justify-between items-center text-xs"
                      >
                        <div>
                          <p className="font-bold text-slate-800">{p.name}</p>
                          <p className="text-[10px] text-slate-500 font-mono">Barcode: {p.barcode}</p>
                        </div>
                        <span className="bg-slate-100 text-slate-600 font-bold px-2 py-1 rounded-md text-[10px]">
                          Stock: {getStockValue(p)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {selectedProduct && (
                <div className="bg-blue-50/60 p-3 rounded-xl border border-blue-100 text-xs">
                  <p className="font-bold text-blue-900">{selectedProduct.name}</p>
                  <p className="text-slate-500 text-[11px]">Current Stock: <span className="font-bold text-slate-700">{getStockValue(selectedProduct)}</span></p>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Supplier</label>
                <select
                  value={stockSupplierId}
                  onChange={(e) => setStockSupplierId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-semibold text-slate-800"
                  required
                >
                  <option value="">-- Choose Supplier --</option>
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Added Stock Quantity</label>
                <input
                  type="number"
                  min="1"
                  placeholder="e.g. 50"
                  value={addQty}
                  onChange={(e) => setAddQty(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-semibold"
                  required
                />
              </div>

              <div className="pt-2 flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setIsAddStockOpen(false)}
                  className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-gradient-to-tr from-blue-600 to-indigo-600 hover:shadow-lg hover:shadow-blue-500/30 text-white font-bold text-xs rounded-xl transition-all disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? 'Updating...' : 'Update Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* PRODUCT LIST TABLE */}
      <div className="relative overflow-hidden bg-white border border-slate-200/80 rounded-3xl shadow-sm">
        <div className="relative z-10 px-5 py-4 border-b border-slate-100 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-sm shadow-blue-500/30">
              <Package className="w-4 h-4 text-white" />
            </div>
            <h2 className="text-xs font-black text-slate-800 uppercase tracking-wide">Product List</h2>
          </div>
          <span className="text-[11px] text-blue-700 font-bold bg-blue-500/10 border border-blue-200/50 px-2.5 py-1 rounded-full">{filteredProducts.length} items</span>
        </div>

        <div className="relative z-10 overflow-auto max-h-[700px]">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-20 bg-slate-50">
              <tr className="text-slate-700 bg-slate-50/80 border-b-2 border-slate-200 uppercase text-[11px] tracking-wider font-extrabold">
                <th className="px-4 py-3.5">Product</th>
                <th className="px-4 py-3.5">Supplier</th>
                <th className="px-4 py-3.5">Category</th>
                <th className="px-4 py-3.5 text-center">Stock</th>
                <th className="px-4 py-3.5 text-center">Min Stock</th>
                <th className="px-4 py-3.5 text-center">Unit Cost</th>
                <th className="px-4 py-3.5 text-center">Price</th>
                <th className="px-4 py-3.5 text-center">Expiry</th>
                <th className="px-4 py-3.5 text-right">Status</th>
                <th className="px-4 py-3.5 text-right">Ledger</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {filteredProducts.length > 0 ? filteredProducts.map((p, idx) => {
                const stockVal = getStockValue(p);
                const statusText = p.status || (stockVal > 10 ? 'In Stock' : stockVal > 0 ? 'Low Stock' : 'Out of Stock');
                const isExpired = statusText === 'Expired';
                const statusBadge = isExpired
                  ? 'bg-purple-500/10 text-purple-700 border border-purple-300/40'
                  : statusText === 'Low Stock'
                  ? 'bg-amber-500/10 text-amber-700 border border-amber-300/40'
                  : stockVal > 0
                  ? 'bg-emerald-500/10 text-emerald-700 border border-emerald-300/40'
                  : 'bg-rose-500/10 text-rose-700 border border-rose-300/40';

                return (
                  <tr key={p.id} className={`hover:bg-slate-50 transition-colors ${idx % 2 === 1 ? 'bg-slate-50/40' : ''}`}>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-slate-100 text-indigo-600 border border-slate-200/60 flex items-center justify-center shrink-0">
                          <CategoryIcon category={p.category} className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 truncate">{p.name}</p>
                          <p className="text-[10px] font-mono text-slate-400 truncate">{p.barcode}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-slate-500">{p.supplierName || 'N/A'}</td>
                    <td className="px-4 py-3.5">{p.category}</td>
                    <td className="px-4 py-3.5 text-center font-bold text-blue-600">{stockVal}</td>
                    <td className="px-4 py-3.5 text-center">
                      {canWrite ? (
                        <MinStockEditor product={p} onUpdated={(updated) => {
                          setProducts((prev) => prev.map((x) => (x.id === updated.id ? { ...x, minStock: updated.minStock } : x)));
                        }} />
                      ) : (
                        <span className="font-semibold text-slate-700">{p.minStock ?? 10}</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-center">₱{Number(p.unitCost || 0).toFixed(2)}</td>
                    <td className="px-4 py-3.5 text-center font-bold text-slate-900">₱{Number(p.sellingPrice || 0).toFixed(2)}</td>
                    <td className="px-4 py-3.5 text-center">
                      {canWrite ? (
                        <ExpiryEditor product={p} onUpdated={(updated) => {
                          setProducts((prev) => prev.map((x) => (x.id === updated.id ? { ...x, expiryDate: updated.expiryDate } : x)));
                        }} />
                      ) : (
                        <span className="font-semibold text-slate-700">
                          {p.expiryDate ? new Date(p.expiryDate).toLocaleDateString() : '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold ${statusBadge}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {statusText}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setHistoryProduct(p)}
                        title="Stock history"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-[11px] font-bold cursor-pointer"
                      >
                        <History className="w-3.5 h-3.5" />
                        History
                      </button>
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => setAdjustProduct(p)}
                          title="Adjust stock"
                          className="ml-1.5 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 text-[11px] font-bold cursor-pointer"
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5" />
                          Adjust
                        </button>
                      )}
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan="10" className="px-4 py-10 text-center text-slate-400 font-semibold">
                    No products found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {historyProduct && (
        <StockHistoryModal
          key={historyProduct.id}
          product={historyProduct}
          onClose={() => setHistoryProduct(null)}
          exportToExcel={exportToExcel}
        />
      )}
      {adjustProduct && (
        <AdjustStockModal
          key={adjustProduct.id}
          product={adjustProduct}
          onClose={() => setAdjustProduct(null)}
          onAdjusted={(updated) => setProducts((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))}
        />
      )}

      <PurchaseOrdersList
        isOpen={isPurchaseOrderOpen}
        onClose={() => setIsPurchaseOrderOpen(false)}
        products={products}
      />

      <ReceivingReportModal
        isOpen={isReceivingReportOpen}
        onClose={() => setIsReceivingReportOpen(false)}
        onSaved={onDataChanged}
      />

      <PurchaseReturnModal
        isOpen={isPurchaseReturnOpen}
        onClose={() => setIsPurchaseReturnOpen(false)}
        onSaved={onDataChanged}
      />
    </div>
  );
}

/**
 * Inline editable expiry-date input. PATCHes /api/products/:id on change,
 * which lets the backend detect crossings into the expiry warning window
 * and fire the alert email.
 */
function ExpiryEditor({ product, onUpdated }) {
  const toInput = (v) => {
    if (!v) return '';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const [value, setValue] = React.useState(toInput(product.expiryDate));
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState('');

  React.useEffect(() => { setValue(toInput(product.expiryDate)); }, [product.expiryDate]);

  const commit = async (next) => {
    setSaving(true); setErr('');
    try {
      const res = await apiFetch(`${API_BASE_URL}/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiryDate: next || null }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const updated = await res.json();
      onUpdated({ id: product.id, expiryDate: updated.expiryDate });
    } catch (e) {
      setErr(e.message || 'save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-0.5">
      <input
        type="date"
        value={value}
        disabled={saving}
        onChange={(e) => { setValue(e.target.value); commit(e.target.value); }}
        className="bg-white border border-slate-300 rounded px-2 py-0.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        aria-label={`Expiry date for ${product.name}`}
      />
      {err && <span className="text-[10px] text-rose-600 font-semibold">{err}</span>}
    </div>
  );
}

/**
 * Inline editable min-stock (reorder level) input. PATCHes /api/products/:id
 * on change — this is the threshold the low-stock alert system compares
 * current stock against (see backend/services/lowStockAlerts.js).
 */
function MinStockEditor({ product, onUpdated }) {
  const [value, setValue] = React.useState(product.minStock ?? 10);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState('');

  React.useEffect(() => { setValue(product.minStock ?? 10); }, [product.minStock]);

  const commit = async (next) => {
    const num = Number(next);
    if (!Number.isFinite(num) || num < 0) return;
    setSaving(true); setErr('');
    try {
      const res = await apiFetch(`${API_BASE_URL}/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minStock: num }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const updated = await res.json();
      onUpdated({ id: product.id, minStock: updated.minStock });
    } catch (e) {
      setErr(e.message || 'save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-0.5">
      <input
        type="number"
        min="0"
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        className="w-16 bg-white border border-slate-300 rounded px-2 py-0.5 text-xs text-slate-800 text-center focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        aria-label={`Min stock threshold for ${product.name}`}
      />
      {err && <span className="text-[10px] text-rose-600 font-semibold">{err}</span>}
    </div>
  );
}

// ==========================================
// SUPPLIER REPORTS PAGE COMPONENT
// ==========================================
function ReportsPage({ products, setProducts, suppliers, exportToExcel }) {
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [supplierMenuOpen, setSupplierMenuOpen] = useState(false);
  const supplierMenuRef = useRef(null);

  // Close the supplier dropdown when clicking outside of it
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (supplierMenuRef.current && !supplierMenuRef.current.contains(e.target)) {
        setSupplierMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedSupplier = suppliers.find((s) => s.id === Number(selectedSupplierId));

  const supplierProducts = useMemo(() => {
    if (!selectedSupplierId) return [];
    return products.filter(p => p.supplierId === Number(selectedSupplierId));
  }, [products, selectedSupplierId]);

  const handleExportReceivingReport = () => {
    if (!selectedSupplierId) {
      alert("Please select a supplier first!");
      return;
    }

    const data = supplierProducts.map(p => {
      const stock = getStockValue(p);
      return {
        'RR Number': `RR-${p.id}`,
        'Supplier': p.supplierName || 'N/A',
        'Product Name': p.name,
        'Received Stock': stock,
        'Unit Cost (₱)': Number(p.unitCost || 0).toFixed(2),
        'Total Value (₱)': (stock * Number(p.unitCost || 0)).toFixed(2),
        'Arrival Date': p.batchDate
      };
    });

    const supplier = suppliers.find(s => s.id === Number(selectedSupplierId));
    exportToExcel(data, `Receiving_Report_${supplier?.name?.replace(/\s+/g, '_')}`);
  };

  return (
    <div className="space-y-6">
      <div className="relative overflow-visible bg-white border border-slate-200/80 rounded-3xl shadow-sm p-5">
        {/* z-20 so the dropdown (which visually overflows into the card below) always wins the
            stacking tie against the results card's own z-10 header — same reasoning as the category
            filter above the Product List. */}
        <div className="relative z-20 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="w-full md:w-96">
            <label className="block text-xs font-bold text-blue-600 uppercase tracking-wide mb-1.5">
              Select Supplier for Report
            </label>
            <div className="relative" ref={supplierMenuRef}>
              <button
                type="button"
                onClick={() => setSupplierMenuOpen((o) => !o)}
                className="w-full flex items-center gap-2 bg-white border border-slate-200/80 shadow-sm text-slate-800 pl-4 pr-3 py-3 rounded-2xl text-sm font-semibold hover:border-blue-300 transition-colors cursor-pointer"
              >
                <Truck className="w-4 h-4 text-blue-500 shrink-0" />
                <span className="flex-1 text-left truncate">{selectedSupplier ? selectedSupplier.name : '-- Choose Supplier --'}</span>
                <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${supplierMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {supplierMenuOpen && (
                <div className="absolute top-full left-0 mt-2 w-full bg-white border border-slate-200 rounded-xl shadow-xl z-30 py-1.5 max-h-64 overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => { setSelectedSupplierId(''); setSupplierMenuOpen(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${!selectedSupplierId ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    <Truck className="w-3.5 h-3.5" />
                    <span className="flex-1 text-left">-- Choose Supplier --</span>
                    {!selectedSupplierId && <Check className="w-3.5 h-3.5" />}
                  </button>
                  {suppliers.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-slate-400">No suppliers yet</p>
                  ) : (
                    suppliers.map((s) => {
                      const active = Number(selectedSupplierId) === s.id;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => { setSelectedSupplierId(String(s.id)); setSupplierMenuOpen(false); }}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${active ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}
                        >
                          <Truck className="w-3.5 h-3.5 shrink-0" />
                          <span className="flex-1 text-left truncate">{s.name}</span>
                          {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleExportReceivingReport}
              disabled={!selectedSupplierId}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-xs rounded-full shadow-md shadow-blue-500/30 hover:shadow-lg hover:shadow-blue-500/40 transition-all disabled:opacity-50 disabled:shadow-none cursor-pointer"
            >
              <Truck className="w-4 h-4" />
              <span>Export Receiving Report</span>
            </button>
          </div>
        </div>
      </div>

      <div className="relative overflow-hidden bg-white border border-slate-200/80 rounded-3xl shadow-sm">
        <div className="relative z-10 px-5 py-4 border-b border-slate-100 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-sm shadow-blue-500/30">
              <BarChart3 className="w-4 h-4 text-white" />
            </div>
            <h2 className="text-xs font-black text-slate-800 uppercase tracking-wide">
              {selectedSupplierId ? 'Products supplied by selected supplier' : 'Select a supplier above to view list'}
            </h2>
          </div>
          <span className="text-[11px] text-blue-700 font-bold bg-blue-500/10 border border-blue-200/50 px-2.5 py-1 rounded-full">{supplierProducts.length} items found</span>
        </div>

        <div className="relative z-10 overflow-y-auto overflow-x-hidden">
          <table className="w-full table-fixed text-left text-xs">
            <colgroup>
              <col className="w-[30%]" />
              <col className="w-[15%]" />
              <col className="w-[12%]" />
              <col className="w-[15%]" />
              <col className="w-[15%]" />
              <col className="w-[13%]" />
            </colgroup>
            <thead>
              <tr className="text-slate-700 bg-slate-50/80 border-b-2 border-slate-200 uppercase text-[11px] tracking-wider font-extrabold">
                <th className="px-4 py-3.5">Product Name</th>
                <th className="px-4 py-3.5">Category</th>
                <th className="px-4 py-3.5 text-center">Stock</th>
                <th className="px-4 py-3.5 text-center">Unit Cost</th>
                <th className="px-4 py-3.5 text-center">Total Value</th>
                <th className="px-4 py-3.5 text-center">Batch Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/40 font-medium text-slate-700">
              {supplierProducts.length > 0 ? (
                supplierProducts.map((p, idx) => {
                  const stockVal = getStockValue(p);
                  return (
                    <tr key={p.id} className={`hover:bg-slate-50 transition-colors ${idx % 2 === 1 ? 'bg-slate-50/40' : ''}`}>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-slate-100 text-indigo-600 border border-slate-200/60 flex items-center justify-center shrink-0">
                            <CategoryIcon category={p.category} className="w-4 h-4" />
                          </div>
                          <span className="font-semibold text-slate-900 break-words">{p.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 break-words">{p.category}</td>
                      <td className="px-4 py-3.5 text-center font-bold text-blue-600">{stockVal}</td>
                      <td className="px-4 py-3.5 text-center">₱{Number(p.unitCost || 0).toFixed(2)}</td>
                      <td className="px-4 py-3.5 text-center font-semibold">₱{(stockVal * Number(p.unitCost || 0)).toFixed(2)}</td>
                      <td className="px-4 py-3.5 text-center">{p.batchDate}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="6" className="px-4 py-10 text-center text-slate-400 font-semibold">
                    {selectedSupplierId ? 'No products found for this supplier.' : 'Please select a supplier from the dropdown.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const LEDGER_PAGE_SIZE = 100;
const LEDGER_TYPE_LABELS = {
  OPENING: 'Opening balance',
  PURCHASE_RECEIPT: 'Received',
  MANUAL_ADD: 'Stock added',
  SALE: 'Sale',
  PURCHASE_RETURN: 'Pull-out (return)',
  ADJUSTMENT: 'Adjustment',
};
const ledgerPeso = (n) => `₱${Number(n).toFixed(2)}`;

// All-products Subsidiary Ledger / History Report — every stock movement (sales, receiving reports,
// pull-outs, adjustments, opening stock) across every product, in one place, with each row's
// transaction/reference number. Reuses the same /api/stock-movements endpoint the per-product Stock
// History modal is built on, just without a productId filter.
function LedgerReportPage({ exportToExcel }) {
  const [movements, setMovements] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const applyPage = (rows, before) => {
    setMovements((prev) => (before ? [...prev, ...rows] : rows));
    setHasMore(rows.length === LEDGER_PAGE_SIZE);
  };

  const fetchPage = useCallback(
    async (before) => {
      const query = new URLSearchParams({ limit: String(LEDGER_PAGE_SIZE) });
      if (before) query.set('before', String(before));
      if (fromDate) query.set('from', fromDate);
      if (toDate) query.set('to', toDate);
      if (typeFilter) query.set('type', typeFilter);
      const res = await apiFetch(`${API_BASE_URL}/stock-movements?${query}`);
      if (!res.ok) throw new Error('Failed to load the ledger');
      return res.json();
    },
    [fromDate, toDate, typeFilter]
  );

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    fetchPage()
      .then((rows) => {
        if (!cancelled) applyPage(rows);
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
  }, [fetchPage]);

  const loadOlder = async () => {
    const before = movements[movements.length - 1].id;
    setIsLoading(true);
    setError(null);
    try {
      applyPage(await fetchPage(before), before);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      const query = new URLSearchParams();
      if (fromDate) query.set('from', fromDate);
      if (toDate) query.set('to', toDate);
      if (typeFilter) query.set('type', typeFilter);
      const res = await apiFetch(`${API_BASE_URL}/stock-movements/export?${query}`);
      if (!res.ok) throw new Error('Failed to export the ledger');
      const rows = (await res.json()).map((m) => ({
        'When': new Date(m.createdAt).toLocaleString(),
        'Product': m.product?.name || '',
        'Barcode': m.product?.barcode || '',
        'Type': LEDGER_TYPE_LABELS[m.type] || m.type,
        'Change': m.quantity,
        'Balance After': m.balanceAfter,
        'Amount (₱)': m.amount != null ? Number(m.amount).toFixed(2) : '',
        'Reference': m.referenceNo || '',
        'PO Number': m.poNumber || '',
        'Reason': m.reason || '',
        'By': m.user?.username || '',
      }));
      await exportToExcel(rows, 'Ledger_History_Report');
    } catch (err) {
      setExportError(err.message);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="relative overflow-visible bg-white border border-slate-200/80 rounded-3xl shadow-sm p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              max={toDate || undefined}
              className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              min={fromDate || undefined}
              className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">Movement Type</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            >
              <option value="">All types</option>
              {Object.entries(LEDGER_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          {(fromDate || toDate || typeFilter) && (
            <button
              type="button"
              onClick={() => { setFromDate(''); setToDate(''); setTypeFilter(''); }}
              className="text-[11px] font-bold text-slate-400 hover:text-slate-600 transition-colors cursor-pointer mb-0.5"
            >
              Clear filters
            </button>
          )}
          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting}
            className="ml-auto flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200/80 text-slate-600 font-semibold text-xs rounded-xl hover:border-indigo-200 hover:bg-slate-50 hover:text-slate-900 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 text-emerald-600" />}
            <span>Export</span>
          </button>
        </div>
      </div>

      {exportError && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">{exportError}</div>
      )}

      <div className="relative overflow-hidden bg-white border border-slate-200/80 rounded-3xl shadow-sm">
        <div className="relative z-10 px-5 py-4 border-b border-slate-100 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-sm shadow-blue-500/30">
              <History className="w-4 h-4 text-white" />
            </div>
            <h2 className="text-xs font-black text-slate-800 uppercase tracking-wide">Every stock movement, across all products</h2>
          </div>
        </div>

        <div className="overflow-x-auto overflow-y-auto max-h-[700px]">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-extrabold uppercase text-[10px] tracking-wider border-b-2 border-slate-200">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-center">Change</th>
                <th className="px-4 py-3 text-center">Balance</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {error && (
                <tr>
                  <td colSpan="8" className="px-4 py-6 text-center text-rose-600 font-semibold">{error}</td>
                </tr>
              )}
              {!isLoading && !error && movements.length === 0 && (
                <tr>
                  <td colSpan="8" className="px-4 py-10 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <Inbox className="w-6 h-6" />
                      <span>No stock movements match these filters.</span>
                    </div>
                  </td>
                </tr>
              )}
              {movements.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{new Date(m.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-800">{m.product?.name}</p>
                    <p className="text-[10px] text-slate-400 font-mono">{m.product?.barcode}</p>
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-700 whitespace-nowrap">{LEDGER_TYPE_LABELS[m.type] || m.type}</td>
                  <td className={`px-4 py-3 text-center font-black ${m.quantity > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                  </td>
                  <td className="px-4 py-3 text-center font-bold text-slate-900">{m.balanceAfter}</td>
                  <td className="px-4 py-3 text-right text-slate-700 font-semibold whitespace-nowrap">
                    {m.amount != null ? ledgerPeso(m.amount) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {m.referenceNo && <span className="font-mono text-slate-700">{m.referenceNo}</span>}
                    {m.poNumber && <span className="text-slate-400"> ({m.poNumber})</span>}
                    {m.referenceNo && m.reason ? ' — ' : ''}
                    {m.reason}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{m.user?.username || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-6 text-slate-400 text-xs">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading...
          </div>
        )}
        {!isLoading && hasMore && (
          <div className="flex justify-center py-4">
            <button
              type="button"
              onClick={loadOlder}
              className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 transition cursor-pointer"
            >
              Load older
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Admin-side Balik Tangkilik Members page: a searchable list on the left, and the selected
// member's points-earning ledger on the right. Registration itself stays POS-only (it happens
// inline at checkout) — this page is read-only.
function MembersPage() {
  const [members, setMembers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedMember, setSelectedMember] = useState(null);

  const [history, setHistory] = useState([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    apiFetch(`${API_BASE_URL}/members`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load members');
        return res.json();
      })
      .then((rows) => {
        if (!cancelled) setMembers(rows);
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
  }, []);

  useEffect(() => {
    if (!selectedMember) return;
    let cancelled = false;
    setIsHistoryLoading(true);
    setHistoryError(null);
    apiFetch(`${API_BASE_URL}/members/${selectedMember.id}/points-history`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load points history');
        return res.json();
      })
      .then((rows) => {
        if (!cancelled) setHistory(rows);
      })
      .catch((err) => {
        if (!cancelled) setHistoryError(err.message);
      })
      .finally(() => {
        if (!cancelled) setIsHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedMember]);

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.name.toLowerCase().includes(q) || m.cardNumber.includes(q));
  }, [members, search]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,320px)_1fr] gap-6 items-start">
      {/* Member list */}
      <div className="bg-white border border-slate-200/80 rounded-3xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by name or card number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-full pl-9 pr-4 py-2 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-all"
            />
          </div>
        </div>
        <div className="max-h-[640px] overflow-y-auto divide-y divide-slate-100">
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-10 text-slate-400 text-xs">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading members...
            </div>
          )}
          {error && <div className="p-4 text-rose-600 text-xs font-semibold">{error}</div>}
          {!isLoading && !error && filteredMembers.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-slate-400 text-xs">
              <Inbox className="w-6 h-6" />
              <span>No members {search ? 'match your search' : 'registered yet'}.</span>
            </div>
          )}
          {filteredMembers.map((m) => (
            <button
              key={m.id}
              onClick={() => setSelectedMember(m)}
              className={`w-full flex items-center justify-between gap-2 p-4 text-left transition-colors cursor-pointer ${
                selectedMember?.id === m.id ? 'bg-indigo-50' : 'hover:bg-slate-50'
              }`}
            >
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-800 truncate">{m.name}</div>
                <div className="text-[10px] text-slate-400 font-mono">Card #{m.cardNumber}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0 text-amber-500 font-black text-xs">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                {Number(m.points).toFixed(2)}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Selected member detail + points history */}
      <div className="bg-white border border-slate-200/80 rounded-3xl shadow-sm overflow-hidden">
        {!selectedMember ? (
          <div className="flex flex-col items-center justify-center gap-2 py-24 text-slate-400 text-xs">
            <Users className="w-8 h-8" />
            <span>Select a member to see their points history.</span>
          </div>
        ) : (
          <>
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-sm shadow-blue-500/30 shrink-0">
                  <Users className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-black text-slate-800 truncate">{selectedMember.name}</h2>
                  <p className="text-[11px] text-slate-500 font-semibold">
                    Card #{selectedMember.cardNumber}
                    {selectedMember.phone ? ` — ${selectedMember.phone}` : ''}
                    {selectedMember.address ? ` — ${selectedMember.address}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 bg-amber-50 text-amber-600 font-black text-sm px-3 py-1.5 rounded-full shrink-0">
                <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                {Number(selectedMember.points).toFixed(2)} pts
              </div>
            </div>

            <div className="overflow-x-auto overflow-y-auto max-h-[560px]">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-extrabold uppercase text-[10px] tracking-wider border-b-2 border-slate-200">
                  <tr>
                    <th className="px-4 py-3">When</th>
                    <th className="px-4 py-3">Transaction</th>
                    <th className="px-4 py-3 text-right">Amount Paid</th>
                    <th className="px-4 py-3 text-center">Points Earned</th>
                    <th className="px-4 py-3 text-center">Balance After</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {isHistoryLoading && (
                    <tr>
                      <td colSpan="5" className="px-4 py-10 text-center text-slate-400">
                        <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading...
                      </td>
                    </tr>
                  )}
                  {historyError && (
                    <tr>
                      <td colSpan="5" className="px-4 py-6 text-center text-rose-600 font-semibold">{historyError}</td>
                    </tr>
                  )}
                  {!isHistoryLoading && !historyError && history.length === 0 && (
                    <tr>
                      <td colSpan="5" className="px-4 py-10 text-center text-slate-400">
                        <div className="flex flex-col items-center gap-2">
                          <Inbox className="w-6 h-6" />
                          <span>No points earned yet.</span>
                        </div>
                      </td>
                    </tr>
                  )}
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{new Date(h.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-3 font-mono text-slate-700">{h.transaction?.transactionNo || '—'}</td>
                      <td className="px-4 py-3 text-right text-slate-700 font-semibold whitespace-nowrap">
                        {h.transaction ? ledgerPeso(h.transaction.totalAmount) : '—'}
                      </td>
                      <td className="px-4 py-3 text-center font-black text-emerald-600">+{Number(h.points).toFixed(2)}</td>
                      <td className="px-4 py-3 text-center font-bold text-slate-900">{Number(h.balanceAfter).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Stock & sales reconciliation report (Phase 5) — cross-checks the ledger's own math against
// itself (and against live stock) per product, plus the POS's reported sales totals against the
// revenue its own SALE ledger rows carry. Read-only, always recomputed live from the ledger.
const RECONCILIATION_FLOOR_DATE = '2026-08-01'; // mirrors ReconciliationReportModel.FLOOR_DATE

function ReconciliationPage({ exportToExcel }) {
  const [fromDate, setFromDate] = useState(RECONCILIATION_FLOOR_DATE);
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAllRows, setShowAllRows] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    const query = new URLSearchParams({ from: fromDate, to: toDate });
    apiFetch(`${API_BASE_URL}/reconciliation-report?${query}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Failed to build the reconciliation report');
        return body;
      })
      .then((body) => {
        if (!cancelled) setReport(body);
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
  }, [fromDate, toDate]);

  const visibleRows = useMemo(() => {
    if (!report) return [];
    return showAllRows ? report.stock.rows : report.stock.rows.filter((r) => r.mismatch);
  }, [report, showAllRows]);

  const handleExport = async () => {
    if (!report) return;
    setIsExporting(true);
    try {
      const stockRows = report.stock.rows.map((r) => ({
        'Product': r.name,
        'Barcode': r.barcode || '',
        'Opening': r.openingStock,
        'Received': r.received,
        'Manual Add': r.manualAdd,
        'Returned': r.returned,
        'Sold': r.sold,
        'Adjustment': r.adjustment,
        'Expected Closing': r.expectedClosing,
        'Actual Closing': r.actualClosing,
        'Mismatch': r.mismatch ? 'YES' : '',
      }));
      const salesRows = [
        {
          'From': report.from,
          'To': report.to,
          'Transactions': report.sales.transactionCount,
          'POS Gross Sales (₱)': report.sales.posGrossSales.toFixed(2),
          'POS Discounts (₱)': report.sales.posDiscounts.toFixed(2),
          'POS Net Sales (₱)': report.sales.posNetSales.toFixed(2),
          'Ledger Sale Revenue (₱)': report.sales.ledgerSaleRevenue.toFixed(2),
          'Mismatch': report.sales.mismatch ? 'YES' : '',
          'Transactions Without Movements': report.sales.transactionsWithoutMovements.length,
        },
      ];
      await exportToExcel(null, `Reconciliation_${report.from}_to_${report.to}`, [
        { name: 'Stock', rows: stockRows },
        { name: 'Sales', rows: salesRows },
      ]);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="relative overflow-visible bg-white border border-slate-200/80 rounded-3xl shadow-sm p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">From</label>
            <input
              type="date"
              value={fromDate}
              min={RECONCILIATION_FLOOR_DATE}
              max={toDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">To</label>
            <input
              type="date"
              value={toDate}
              min={fromDate}
              onChange={(e) => setToDate(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <p className="text-[11px] text-slate-400 font-medium mb-2">
            Can't start before {RECONCILIATION_FLOOR_DATE} — the historical May–July 2026 sales import has no stock ledger data before then.
          </p>
          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting || !report}
            className="ml-auto flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200/80 text-slate-600 font-semibold text-xs rounded-xl hover:border-indigo-200 hover:bg-slate-50 hover:text-slate-900 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 text-emerald-600" />}
            <span>Export</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">{error}</div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-10 text-slate-400 text-xs">
          <Loader2 className="w-4 h-4 animate-spin" /> Building reconciliation report...
        </div>
      )}

      {!isLoading && !error && report && (
        <>
          {/* Sales cross-check */}
          <div className="bg-white border border-slate-200/80 rounded-3xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-black text-slate-800 uppercase tracking-wide">Sales Cross-Check</h2>
              <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                report.sales.mismatch ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
              }`}>
                {report.sales.mismatch ? <AlertTriangle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                {report.sales.mismatch ? 'Mismatch found' : 'Reconciled'}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="bg-slate-50 rounded-xl p-3">
                <div className="text-slate-400 font-semibold text-[10px] uppercase">Transactions</div>
                <div className="text-slate-900 font-black text-sm mt-0.5">{report.sales.transactionCount}</div>
              </div>
              <div className="bg-slate-50 rounded-xl p-3">
                <div className="text-slate-400 font-semibold text-[10px] uppercase">POS Gross Sales</div>
                <div className="text-slate-900 font-black text-sm mt-0.5">₱{report.sales.posGrossSales.toFixed(2)}</div>
              </div>
              <div className="bg-slate-50 rounded-xl p-3">
                <div className="text-slate-400 font-semibold text-[10px] uppercase">POS Net Sales</div>
                <div className="text-slate-900 font-black text-sm mt-0.5">₱{report.sales.posNetSales.toFixed(2)}</div>
              </div>
              <div className={`rounded-xl p-3 ${report.sales.mismatch ? 'bg-rose-50' : 'bg-slate-50'}`}>
                <div className="text-slate-400 font-semibold text-[10px] uppercase">Ledger Sale Revenue</div>
                <div className={`font-black text-sm mt-0.5 ${report.sales.mismatch ? 'text-rose-600' : 'text-slate-900'}`}>
                  ₱{report.sales.ledgerSaleRevenue.toFixed(2)}
                </div>
              </div>
            </div>
            {report.sales.transactionsWithoutMovements.length > 0 && (
              <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
                <p className="font-bold mb-1">{report.sales.transactionsWithoutMovements.length} transaction(s) have no matching stock movements:</p>
                <p className="font-mono">
                  {report.sales.transactionsWithoutMovements.map((t) => t.transactionNo).join(', ')}
                </p>
              </div>
            )}
          </div>

          {/* Stock math */}
          <div className="relative overflow-hidden bg-white border border-slate-200/80 rounded-3xl shadow-sm">
            <div className="relative z-10 px-5 py-4 border-b border-slate-100 flex flex-wrap justify-between items-center gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-sm shadow-blue-500/30">
                  <Scale className="w-4 h-4 text-white" />
                </div>
                <h2 className="text-xs font-black text-slate-800 uppercase tracking-wide">
                  Stock Reconciliation — {report.stock.mismatchCount} of {report.stock.rows.length} products mismatched
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowAllRows((v) => !v)}
                className="text-[11px] font-bold text-blue-600 hover:text-blue-700 transition-colors cursor-pointer"
              >
                {showAllRows ? 'Show only mismatches' : 'Show all products'}
              </button>
            </div>

            <div className="overflow-x-auto overflow-y-auto max-h-[600px]">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-extrabold uppercase text-[10px] tracking-wider border-b-2 border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3 text-center">Opening</th>
                    <th className="px-4 py-3 text-center">Received</th>
                    <th className="px-4 py-3 text-center">Returned</th>
                    <th className="px-4 py-3 text-center">Sold</th>
                    <th className="px-4 py-3 text-center">Adjusted</th>
                    <th className="px-4 py-3 text-center">Expected</th>
                    <th className="px-4 py-3 text-center">Actual</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan="9" className="px-4 py-10 text-center text-slate-400">
                        <div className="flex flex-col items-center gap-2">
                          {report.stock.mismatchCount === 0 ? (
                            <>
                              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                              <span>Every product reconciles for this range.</span>
                            </>
                          ) : (
                            <>
                              <Inbox className="w-6 h-6" />
                              <span>No products had stock activity in this range.</span>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  {visibleRows.map((r) => (
                    <tr key={r.productId} className={r.mismatch ? 'bg-rose-50/60' : undefined}>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-800">{r.name}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{r.barcode}</p>
                      </td>
                      <td className="px-4 py-3 text-center text-slate-700">{r.openingStock}</td>
                      <td className="px-4 py-3 text-center text-emerald-600 font-semibold">{r.received + r.manualAdd > 0 ? `+${r.received + r.manualAdd}` : 0}</td>
                      <td className="px-4 py-3 text-center text-rose-600 font-semibold">{r.returned > 0 ? `-${r.returned}` : 0}</td>
                      <td className="px-4 py-3 text-center text-rose-600 font-semibold">{r.sold > 0 ? `-${r.sold}` : 0}</td>
                      <td className={`px-4 py-3 text-center font-semibold ${r.adjustment > 0 ? 'text-emerald-600' : r.adjustment < 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                        {r.adjustment > 0 ? `+${r.adjustment}` : r.adjustment}
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-slate-900">{r.expectedClosing}</td>
                      <td className="px-4 py-3 text-center font-bold text-slate-900">{r.actualClosing}</td>
                      <td className="px-4 py-3">
                        {r.mismatch ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-600 w-fit">
                            <AlertTriangle className="w-3 h-3" /> Mismatch
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600 w-fit">
                            <CheckCircle2 className="w-3 h-3" /> OK
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}