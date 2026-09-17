import React, { useState, useEffect, useMemo } from 'react';
import { 
  Package, 
  Plus, 
  FileSpreadsheet, 
  RotateCcw, 
  Truck, 
  Search, 
  ChevronDown, 
  X, 
  CheckSquare, 
  Square,
  BarChart3,
  PackagePlus,
  Barcode,
  Loader2
} from 'lucide-react';
import * as XLSX from 'xlsx';

const API_BASE_URL = 'http://localhost:5000/api';

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
        fetch(`${API_BASE_URL}/products`),
        fetch(`${API_BASE_URL}/suppliers`)
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

  const exportToExcel = (data, fileName) => {
    if (!data || data.length === 0) {
      alert("No data available to export.");
      return;
    }
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, `${fileName}_${Date.now()}.xlsx`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center font-sans">
        <div className="flex items-center gap-3 text-slate-600 font-bold text-sm">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          <span>Connecting to database...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6 font-sans">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 max-w-md text-center">
          <p className="text-rose-600 font-bold text-sm mb-2">Database Connection Error</p>
          <p className="text-slate-500 text-xs mb-4">{error}</p>
          <button 
            onClick={fetchInitialData} 
            className="px-4 py-2 bg-blue-600 text-white font-bold text-xs rounded-xl shadow-md hover:bg-blue-700 transition"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-6 font-sans text-slate-800">
      <header className="flex items-center justify-between bg-white px-6 py-4 rounded-2xl shadow-sm mb-6 border border-slate-200">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-blue-600 text-white shadow-md shadow-blue-500/20">
            <Package className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] font-bold tracking-wider text-blue-600 uppercase">POS System</p>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">INVENTORY MANAGEMENT</h1>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-xl border border-slate-200">
          <button
            onClick={() => setActiveTab('inventory')}
            className={`flex items-center gap-2 px-4 py-2 font-bold text-xs rounded-lg transition-all ${
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
            className={`flex items-center gap-2 px-4 py-2 font-bold text-xs rounded-lg transition-all ${
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

      {activeTab === 'inventory' && (
        <InventoryPage 
          products={products} 
          setProducts={setProducts} 
          suppliers={suppliers} 
          exportToExcel={exportToExcel}
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
  );
}

// ==========================================
// INVENTORY PAGE COMPONENT
// ==========================================
function InventoryPage({ products, setProducts, suppliers, exportToExcel }) {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isAddStockOpen, setIsAddStockOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    barcode: '',
    name: '',
    supplierId: '',
    category: '',
    currentStock: '',
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
        unitCost: Number(formData.unitCost) || 0,
        sellingPrice: Number(formData.sellingPrice) || 0,
        batchDate: formData.batchDate || new Date().toISOString().split('T')[0],
        supplierId: Number(formData.supplierId)
      };

      const response = await fetch(`${API_BASE_URL}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error(`HTTP error status ${response.status}`);

      const savedProduct = await response.json();

      setProducts(prev => [savedProduct, ...prev]);
      setFormData({ barcode: '', name: '', supplierId: '', category: '', currentStock: '', unitCost: '', sellingPrice: '', batchDate: '' });
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
      const response = await fetch(`${API_BASE_URL}/products/${selectedProduct.id}/add-stock`, {
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

  const filteredProducts = products.filter(p => 
    p.name?.toLowerCase().includes(search.toLowerCase()) || 
    p.barcode?.toLowerCase().includes(search.toLowerCase()) ||
    p.supplierName?.toLowerCase().includes(search.toLowerCase())
  );

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
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search barcode, product or supplier..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto justify-end">
          <button
            onClick={handleExportInventorySheet}
            className="flex items-center gap-2 px-3.5 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-xs rounded-xl hover:bg-emerald-100 transition shadow-sm cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Export Inventory Sheet</span>
          </button>

          <button
            onClick={() => {
              setIsAddStockOpen(true);
              setIsFormOpen(false);
              resetStockForm();
            }}
            className="flex items-center gap-2 px-3.5 py-2 bg-indigo-50 text-indigo-700 border border-indigo-200 font-bold text-xs rounded-xl hover:bg-indigo-100 transition shadow-sm cursor-pointer"
          >
            <PackagePlus className="w-4 h-4 text-indigo-600" />
            <span>Add Stock</span>
          </button>

          <button
            onClick={() => {
              setIsFormOpen(!isFormOpen);
              setIsAddStockOpen(false);
            }}
            className="flex items-center gap-2 px-3.5 py-2 bg-blue-600 text-white font-bold text-xs rounded-xl hover:bg-blue-700 transition shadow-sm cursor-pointer"
          >
            {isFormOpen ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            <span>{isFormOpen ? 'Close Form' : 'Add Product'}</span>
          </button>
        </div>
      </div>

      {/* ADD NEW PRODUCT FORM */}
      {isFormOpen && (
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-md animate-fadeIn">
          <h2 className="text-sm font-black text-slate-800 uppercase tracking-wide mb-4">Add New Product</h2>
          <form onSubmit={handleAddProduct} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Barcode</label>
              <input type="text" name="barcode" value={formData.barcode} onChange={handleInputChange} placeholder="Auto-generated if blank" className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs" />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Product Name</label>
              <input type="text" name="name" value={formData.name} onChange={handleInputChange} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs" required />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Supplier</label>
              <select name="supplierId" value={formData.supplierId} onChange={handleInputChange} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs" required>
                <option value="">Select Supplier</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Category</label>
              <input type="text" name="category" value={formData.category} onChange={handleInputChange} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs" />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Initial Stock Quantity</label>
              <input type="number" name="currentStock" value={formData.currentStock} onChange={handleInputChange} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs" />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Unit Cost (₱)</label>
              <input type="number" name="unitCost" value={formData.unitCost} onChange={handleInputChange} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs" />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Selling Price (₱)</label>
              <input type="number" name="sellingPrice" value={formData.sellingPrice} onChange={handleInputChange} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs" />
            </div>

            <div className="flex items-end">
              <button 
                type="submit" 
                disabled={isSubmitting}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2.5 rounded-xl transition shadow-md disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : 'Save Product'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: ADD STOCK */}
      {isAddStockOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl p-6 shadow-2xl max-w-md w-full border border-slate-100 animate-fadeIn">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
                <PackagePlus className="w-4 h-4 text-indigo-600" />
                Add Stock Quantity
              </h3>
              <button onClick={() => setIsAddStockOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
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
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-8 py-2.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                        className="p-2.5 hover:bg-indigo-50/50 cursor-pointer transition flex justify-between items-center text-xs"
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
                <div className="bg-indigo-50/60 p-3 rounded-xl border border-indigo-100 text-xs">
                  <p className="font-bold text-indigo-900">{selectedProduct.name}</p>
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
                  className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition disabled:opacity-50"
                >
                  {isSubmitting ? 'Updating...' : 'Update Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PRODUCT LIST TABLE */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center">
          <h2 className="text-xs font-black text-slate-800 uppercase tracking-wide">Live Inventory Table</h2>
          <span className="text-xs text-slate-500 font-semibold">{filteredProducts.length} items</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider">
              <tr>
                <th className="p-3">Barcode</th>
                <th className="p-3">Product Name</th>
                <th className="p-3">Supplier</th>
                <th className="p-3">Category</th>
                <th className="p-3 text-center">Stock</th>
                <th className="p-3 text-center">Unit Cost</th>
                <th className="p-3 text-center">Price</th>
                <th className="p-3 text-center">Expiry</th>
                <th className="p-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {filteredProducts.map(p => {
                const stockVal = getStockValue(p);
                const statusText = p.status || (stockVal > 10 ? 'In Stock' : stockVal > 0 ? 'Low Stock' : 'Out of Stock');
                const isExpired = statusText === 'Expired';

                return (
                  <tr key={p.id} className="hover:bg-slate-50 transition">
                    <td className="p-3 font-mono text-slate-500">{p.barcode}</td>
                    <td className="p-3 font-semibold text-slate-900">{p.name}</td>
                    <td className="p-3 text-slate-500">{p.supplierName || 'N/A'}</td>
                    <td className="p-3">{p.category}</td>
                    <td className="p-3 text-center font-bold text-blue-600">{stockVal}</td>
                    <td className="p-3 text-center">₱{Number(p.unitCost || 0).toFixed(2)}</td>
                    <td className="p-3 text-center">₱{Number(p.sellingPrice || 0).toFixed(2)}</td>
                    <td className="p-3 text-center">
                      <ExpiryEditor product={p} onUpdated={(updated) => {
                        setProducts((prev) => prev.map((x) => (x.id === updated.id ? { ...x, expiryDate: updated.expiryDate } : x)));
                      }} />
                    </td>
                    <td className={`p-3 text-right font-bold ${isExpired ? 'text-rose-600' : stockVal > 10 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {statusText}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
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
      const res = await fetch(`${API_BASE_URL}/products/${product.id}`, {
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

// ==========================================
// SUPPLIER REPORTS PAGE COMPONENT
// ==========================================
function ReportsPage({ products, setProducts, suppliers, exportToExcel }) {
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [returnDetails, setReturnDetails] = useState({
    returnQty: 1,
    reason: 'Damaged'
  });

  const supplierProducts = useMemo(() => {
    if (!selectedSupplierId) return [];
    return products.filter(p => p.supplierId === Number(selectedSupplierId));
  }, [products, selectedSupplierId]);

  const toggleSelectProduct = (id) => {
    if (selectedProductIds.includes(id)) {
      setSelectedProductIds(selectedProductIds.filter(item => item !== id));
    } else {
      setSelectedProductIds([...selectedProductIds, id]);
    }
  };

  const toggleSelectAll = () => {
    if (selectedProductIds.length === supplierProducts.length) {
      setSelectedProductIds([]);
    } else {
      setSelectedProductIds(supplierProducts.map(p => p.id));
    }
  };

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

  const handleGeneratePurchaseReturn = async (e) => {
    e.preventDefault();
    if (selectedProductIds.length === 0) {
      alert("No products selected for Purchase Return.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/purchase-returns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productIds: selectedProductIds,
          returnQty: Number(returnDetails.returnQty),
          reason: returnDetails.reason,
          supplierId: Number(selectedSupplierId)
        })
      });

      if (!response.ok) throw new Error(`HTTP error status ${response.status}`);

      const { updatedProducts, returnRecords } = await response.json();

      setProducts(prev => prev.map(p => {
        const updated = updatedProducts.find(u => u.id === p.id);
        return updated ? updated : p;
      }));

      exportToExcel(returnRecords, `Purchase_Return_${Date.now()}`);
      setIsReturnModalOpen(false);
      setSelectedProductIds([]);
      alert("Purchase Return processed and database updated!");
    } catch (err) {
      alert(`Error processing purchase return: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="w-full md:w-80">
            <label className="block text-xs font-bold text-blue-600 uppercase tracking-wide mb-1">
              Select Supplier for Report
            </label>
            <div className="relative">
              <select
                value={selectedSupplierId}
                onChange={(e) => {
                  setSelectedSupplierId(e.target.value);
                  setSelectedProductIds([]);
                }}
                className="w-full bg-blue-50/50 border border-blue-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none appearance-none"
              >
                <option value="">-- Choose Supplier --</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-2.5 pointer-events-none" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleExportReceivingReport}
              disabled={!selectedSupplierId}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-50 text-blue-700 border border-blue-200 font-bold text-xs rounded-xl hover:bg-blue-100 transition disabled:opacity-50 cursor-pointer"
            >
              <Truck className="w-4 h-4 text-blue-600" />
              <span>Export Receiving Report</span>
            </button>

            <button
              onClick={() => setIsReturnModalOpen(true)}
              disabled={selectedProductIds.length === 0}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-rose-50 text-rose-700 border border-rose-200 font-bold text-xs rounded-xl hover:bg-rose-100 transition disabled:opacity-50 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4 text-rose-600" />
              <span>Create Purchase Return ({selectedProductIds.length})</span>
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center">
          <h2 className="text-xs font-black text-slate-800 uppercase tracking-wide">
            {selectedSupplierId ? 'Products supplied by selected supplier' : 'Select a supplier above to view list'}
          </h2>
          <span className="text-xs text-slate-500 font-semibold">{supplierProducts.length} items found</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider">
              <tr>
                <th className="p-3 w-10 text-center">
                  <button onClick={toggleSelectAll} className="text-slate-500">
                    {selectedProductIds.length === supplierProducts.length && supplierProducts.length > 0 ? (
                      <CheckSquare className="w-4 h-4 text-blue-600" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </th>
                <th className="p-3">Product Name</th>
                <th className="p-3">Category</th>
                <th className="p-3 text-center">Stock</th>
                <th className="p-3 text-center">Unit Cost</th>
                <th className="p-3 text-center">Total Value</th>
                <th className="p-3 text-center">Batch Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {supplierProducts.length > 0 ? (
                supplierProducts.map(p => {
                  const isChecked = selectedProductIds.includes(p.id);
                  const stockVal = getStockValue(p);
                  return (
                    <tr key={p.id} className={`hover:bg-slate-50 transition ${isChecked ? 'bg-blue-50/40' : ''}`}>
                      <td className="p-3 text-center">
                        <button onClick={() => toggleSelectProduct(p.id)} className="text-slate-500">
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-blue-600" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                      <td className="p-3 font-semibold text-slate-900">{p.name}</td>
                      <td className="p-3">{p.category}</td>
                      <td className="p-3 text-center font-bold">{stockVal}</td>
                      <td className="p-3 text-center">₱{Number(p.unitCost || 0).toFixed(2)}</td>
                      <td className="p-3 text-center font-semibold">₱{(stockVal * Number(p.unitCost || 0)).toFixed(2)}</td>
                      <td className="p-3 text-center">{p.batchDate}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="7" className="p-6 text-center text-slate-400 font-semibold">
                    {selectedSupplierId ? 'No products found for this supplier.' : 'Please select a supplier from the dropdown.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: PURCHASE RETURN */}
      {isReturnModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl p-6 shadow-2xl max-w-md w-full border border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-rose-600" />
                Process Purchase Return
              </h3>
              <button onClick={() => setIsReturnModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleGeneratePurchaseReturn} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Items Selected</label>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700">
                  {selectedProductIds.length} item(s) selected for return
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Return Quantity (Per Product)</label>
                <input
                  type="number"
                  min="1"
                  value={returnDetails.returnQty}
                  onChange={(e) => setReturnDetails({ ...returnDetails, returnQty: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-semibold"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Reason for Return</label>
                <select
                  value={returnDetails.reason}
                  onChange={(e) => setReturnDetails({ ...returnDetails, reason: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-semibold text-slate-800"
                >
                  <option value="Damaged">Damaged / Defective</option>
                  <option value="Expired">Expired</option>
                  <option value="Incorrect Item">Incorrect Item Sent</option>
                  <option value="Overstock">Overstock Return</option>
                </select>
              </div>

              <div className="pt-2 flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setIsReturnModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-md transition disabled:opacity-50"
                >
                  {isSubmitting ? 'Processing...' : 'Generate & Update'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}