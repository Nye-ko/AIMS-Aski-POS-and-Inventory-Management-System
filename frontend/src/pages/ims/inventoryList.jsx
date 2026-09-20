import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  Sprout, Leaf, Wheat, SprayCan, Wrench,
  Pill, PaintBucket, ShoppingBag, Milk, Palette, Coffee,
  Soup, Cylinder
} from 'lucide-react';
import ExcelJS from 'exceljs';
import PurchaseOrdersList from './PurchaseOrdersList';
import ReceivingReportModal from './ReceivingReportModal';
import PurchaseReturnModal from './PurchaseReturnModal';

import { apiFetch } from '../../auth/apiFetch';
import { useAuth } from '../../auth/AuthContext';

const API_BASE_URL = 'http://localhost:5000/api';

// Same category -> icon mapping as cashierPOS.jsx, so a product shows the
// identical glyph whether viewed at the register or in inventory.
const CATEGORY_ICONS = {
  seeds: Sprout,
  fertilizers: Leaf,
  feeds: Wheat,
  pesticides: SprayCan,
  tools: Wrench,
  hardware: Wrench,
  medicine: Pill,
  pharmacy: Pill,
  paint: PaintBucket,
  paints: Palette,
  grocery: ShoppingBag,
  dairy: Milk,
  bakery: Wheat,
  snacks: ShoppingBag,
  beverages: Coffee,
  household: SprayCan,
  pantry: Soup,
  'canned goods': Cylinder,
};

const getCategoryIcon = (category) => {
  if (!category) return Package;
  return CATEGORY_ICONS[category.toLowerCase()] || Package;
};

function CategoryIcon({ category, className }) {
  const Icon = getCategoryIcon(category);
  // eslint-disable-next-line react-hooks/static-components
  return <Icon className={className} />;
}

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

  const STATUS_STYLES = {
    'In Stock':     { fill: 'FFDCFCE7', font: 'FF15803D' },
    'Low Stock':    { fill: 'FFFEF3C7', font: 'FFB45309' },
    'Out of Stock': { fill: 'FFFEE2E2', font: 'FFB91C1C' },
    'Expired':      { fill: 'FFF3E8FF', font: 'FF7E22CE' },
  };

  const exportToExcel = async (data, fileName) => {
    if (!data || data.length === 0) {
      alert("No data available to export.");
      return;
    }

    const headers = Object.keys(data[0]);
    const moneyHeaders = new Set(headers.filter((h) => h.includes('₱')));
    const statusColIndex = headers.indexOf('Status') + 1;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'AMPC Inventory';
    wb.created = new Date();

    const ws = wb.addWorksheet('Report', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    ws.columns = headers.map((h) => {
      const maxLen = data.reduce((max, row) => {
        const val = row[h];
        return Math.max(max, val == null ? 0 : String(val).length);
      }, h.length);
      return { header: h, key: h, width: Math.min(Math.max(maxLen + 3, 12), 40) };
    });

    data.forEach((row) => {
      const values = {};
      headers.forEach((h) => {
        const raw = row[h];
        values[h] = moneyHeaders.has(h) && raw !== '' && raw != null ? Number(raw) : raw;
      });
      ws.addRow(values);
    });

    const thinBorder = (color) => ({
      top: { style: 'thin', color: { argb: color } },
      bottom: { style: 'thin', color: { argb: color } },
      left: { style: 'thin', color: { argb: color } },
      right: { style: 'thin', color: { argb: color } },
    });

    const headerRow = ws.getRow(1);
    headerRow.height = 20;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = thinBorder('FFCBD5E1');
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

    for (let i = 2; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      const isEven = i % 2 === 0;
      row.eachCell((cell, colNumber) => {
        const header = headers[colNumber - 1];
        cell.border = thinBorder('FFE2E8F0');
        if (moneyHeaders.has(header)) {
          cell.numFmt = '#,##0.00';
          cell.alignment = { horizontal: 'right' };
        } else if (typeof cell.value === 'number') {
          cell.alignment = { horizontal: 'center' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        }
        if (isEven) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        }
      });

      if (statusColIndex > 0) {
        const statusCell = row.getCell(statusColIndex);
        const style = STATUS_STYLES[statusCell.value];
        if (style) {
          statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.fill } };
          statusCell.font = { bold: true, color: { argb: style.font } };
          statusCell.alignment = { horizontal: 'center' };
        }
      }
    }

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileName}_${Date.now()}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
    sellingPrice: '',
    batchDate: ''
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
    setFormData({ barcode: '', name: '', supplierId: '', category: '', currentStock: '', minStock: '', unitCost: '', sellingPrice: '', batchDate: '' });
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
        batchDate: formData.batchDate || new Date().toISOString().split('T')[0],
        supplierId: Number(formData.supplierId)
      };

      const response = await apiFetch(`${API_BASE_URL}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error(`HTTP error status ${response.status}`);

      const savedProduct = await response.json();

      setProducts(prev => [savedProduct, ...prev]);
      setFormData({ barcode: '', name: '', supplierId: '', category: '', currentStock: '', minStock: '', unitCost: '', sellingPrice: '', batchDate: '' });
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

      if (!response.ok) throw new Error(`HTTP error status ${response.status}`);

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

  const handleExportInventorySheet = () => {
    const data = filteredProducts.map(p => {
      const stock = getStockValue(p);
      return {
        'Product ID': p.id,
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
    exportToExcel(data, 'Inventory_Sheet');
  };

  return (
    <div className="space-y-6">
      <div className="relative overflow-visible bg-white border border-slate-200/80 rounded-3xl shadow-sm p-5 space-y-4">
        {/* Row 1: utility actions — uniform neutral toolbar buttons, primary action last */}
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

          {canWrite && <button
            onClick={() => {
              setIsFormOpen(!isFormOpen);
              setIsAddStockOpen(false);
            }}
            className={`ml-auto flex items-center justify-center gap-2 px-4 py-2 font-bold text-xs rounded-full transition-all cursor-pointer ${
              isFormOpen
                ? 'bg-white text-slate-600 border border-slate-200/80 hover:bg-slate-50'
                : 'bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/30 hover:shadow-lg hover:shadow-blue-500/40'
            }`}
          >
            {isFormOpen ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            <span>{isFormOpen ? 'Close Form' : 'Add Product'}</span>
          </button>}
        </div>

        <div className="relative z-10 border-t border-slate-100" />

        {/* Row 2: search + category filter — z-20 so its dropdown (which
            visually overflows into the card below) always wins the stacking
            tie against the Product List card's own z-10 header/table rows */}
        <div className="relative z-20 flex flex-col sm:flex-row gap-2">
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

        <div className="relative z-10 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
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
                    <td className="px-4 py-3.5 text-right">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold ${statusBadge}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {statusText}
                      </span>
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan="9" className="px-4 py-10 text-center text-slate-400 font-semibold">
                    No products found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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
      <div className="relative overflow-hidden bg-white border border-slate-200/80 rounded-3xl shadow-sm p-5">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="w-full md:w-96">
            <label className="block text-xs font-bold text-blue-600 uppercase tracking-wide mb-1.5">
              Select Supplier for Report
            </label>
            <div className="relative">
              <select
                value={selectedSupplierId}
                onChange={(e) => setSelectedSupplierId(e.target.value)}
                className="w-full bg-white border border-slate-200/80 shadow-sm rounded-2xl pl-4 pr-9 py-3 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-400 transition-all appearance-none"
              >
                <option value="">-- Choose Supplier --</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-blue-500 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
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

        <div className="relative z-10 overflow-x-auto">
          <table className="w-full text-left text-xs">
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
                          <span className="font-semibold text-slate-900">{p.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">{p.category}</td>
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