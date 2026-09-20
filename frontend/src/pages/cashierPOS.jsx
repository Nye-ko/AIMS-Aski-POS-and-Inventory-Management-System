import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Trash2, ChevronDown, Plus, Minus,
  Lock, Clock, Banknote, X, Percent, Download, ShieldCheck,
  Check, LayoutGrid, Sprout, Leaf, Wheat, SprayCan, Wrench,
  Pill, PaintBucket, Package, ShoppingCart,
  Wallet, LogOut, ShoppingBag, Milk, Palette, Coffee,
  Soup, Cylinder, CheckCircle2
} from 'lucide-react';
import { exportCsv } from '../utils/exportCsv';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../auth/apiFetch';

// Maps a product/category name to a distinct, representative lucide icon
// for the dropdown menu and product card placeholders — every category
// gets its own glyph (no repeated generic box/basket icon) — falls back
// to a generic box icon only for categories we truly don't recognize.
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
  // Icon is always one of the stable lucide component refs in CATEGORY_ICONS
  // (or Package) — not a new component identity per render.
  // eslint-disable-next-line react-hooks/static-components
  return <Icon className={className} />;
}

const STAT_COLORS = {
  indigo: { card: "bg-blue-50/50 border-l-4 border-blue-500", badge: "bg-blue-100 text-blue-600" },
  emerald: { card: "bg-emerald-50/50 border-l-4 border-emerald-500", badge: "bg-emerald-100 text-emerald-600" },
  amber: { card: "bg-amber-50/50 border-l-4 border-amber-500", badge: "bg-amber-100 text-amber-600" },
  violet: { card: "bg-purple-50/50 border-l-4 border-purple-500", badge: "bg-purple-100 text-purple-600" },
};

function StatCard({ icon: Icon, color, label, value }) {
  return (
    <div className={`rounded-2xl shadow-md shadow-slate-200/60 p-4 flex items-center gap-3 ${STAT_COLORS[color].card}`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${STAT_COLORS[color].badge}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-lg font-extrabold text-slate-900 truncate">{value}</div>
        <div className="text-[11px] text-slate-400 font-medium truncate">{label}</div>
      </div>
    </div>
  );
}

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 18) return "Good Afternoon";
  return "Good Evening";
};

export default function CashierPOS() {
  const { user, token, logout } = useAuth();
  const navigate = useNavigate();

  // A write failed with 401 because the session's JWT points at a user id
  // that no longer exists (e.g. the users table was reseeded) — force a
  // clean re-login instead of leaving the cashier stuck on silent failures.
  const handleStaleSession = () => {
    logout();
    alert('Your session is no longer valid. Please log in again.');
    navigate('/', { replace: true });
  };

  const handleLogout = () => {
    logout();
    navigate('/', { replace: true });
  };
  // LIVE BACKEND STATES
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const categoryMenuRef = useRef(null);
  const [paymentMethod, setPaymentMethod] = useState("Cash");

  const [cart, setCart] = useState([]);

  // FEATURE: Custom post-checkout success screen (replaces the native browser alert)
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [lastSale, setLastSale] = useState(null);

  // FEATURE 1: Supervisor Discount States (percentage & fixed value stay in sync)
  const [discountPercent, setDiscountPercent] = useState(0);
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [supervisorPin, setSupervisorPin] = useState("");
  const [discountApproval, setDiscountApproval] = useState(null); // { token, approver } from POST /api/pos/approve
  const [isApproving, setIsApproving] = useState(false);
  const [tempDiscountPercent, setTempDiscountPercent] = useState(0);
  const [tempDiscountAmount, setTempDiscountAmount] = useState(0);
  const [discountError, setDiscountError] = useState("");

  // FEATURE 2: Pending Transactions States
  const [pendingSales, setPendingSales] = useState([]);
  const [showPendingModal, setShowPendingModal] = useState(false);

  // FEATURE 3: End of Day / X-Reading Reconciliation States
  const [showEODAuthModal, setShowEODAuthModal] = useState(false);
  const [eodSupervisorPin, setEodSupervisorPin] = useState("");
  const [eodApprovalToken, setEodApprovalToken] = useState(null);
  const [eodClosedReportNo, setEodClosedReportNo] = useState(null);
  const [eodFigures, setEodFigures] = useState({ gross: 0, discount: 0, net: 0 });
  const [eodAuthError, setEodAuthError] = useState("");
  const [eodUnlocked, setEodUnlocked] = useState(false);
  const [showEODModal, setShowEODModal] = useState(false);
  const [expectedSales, setExpectedSales] = useState(0);
  const [cashDenominations, setCashDenominations] = useState({
    p1000: 0, p500: 0, p200: 0, p100: 0, p50: 0,
    p20: 0, p10: 0, p5: 0, p1: 0, c25: 0
  });

  // Exchanges a supervisor PIN for a short-lived approval token (the PIN itself is never stored client-side).
  const requestApproval = async (body) => {
    const res = await apiFetch('http://localhost:5000/api/pos/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Supervisor approval failed.');
    return data;
  };

  // Handler for Denomination Inputs
  const handleDenominationChange = (key, value) => {
    const numericValue = value === '' ? 0 : Math.max(0, parseInt(value, 10) || 0);
    setCashDenominations((prev) => ({
      ...prev,
      [key]: numericValue,
    }));
  };

  // FETCH PRODUCTS FROM BACKEND
  const fetchProducts = () => {
    setLoading(true);
    apiFetch('http://localhost:5000/api/products')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch products');
        return res.json();
      })
      .then((data) => {
        setProducts(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error fetching products:', err);
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchProducts();
  }, []);

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

  // DERIVED CALCULATIONS FOR CART
  const subtotal = cart.reduce((sum, item) => sum + (Number(item.unitPrice) * item.quantity), 0);
  const discountAmount = (subtotal * discountPercent) / 100;
  const cartTotal = Math.max(0, subtotal - discountAmount);
  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  // EOD Cash Calculation
  const totalCountedCash = (
    ((cashDenominations.p1000 || 0) * 1000) +
    ((cashDenominations.p500 || 0) * 500) +
    ((cashDenominations.p200 || 0) * 200) +
    ((cashDenominations.p100 || 0) * 100) +
    ((cashDenominations.p50 || 0) * 50) +
    ((cashDenominations.p20 || 0) * 20) +
    ((cashDenominations.p10 || 0) * 10) +
    ((cashDenominations.p5 || 0) * 5) +
    ((cashDenominations.p1 || 0) * 1) +
    ((cashDenominations.c25 || 0) * 0.25)
  );

  const shortOver = totalCountedCash - expectedSales;

  // Category options are derived from whatever the backend actually returns,
  // rather than a fixed list — the dropdown always matches real inventory.
  const categories = Array.from(new Set(products.map((p) => p.category).filter(Boolean)));

  const filteredProducts = products.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === "All" || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Cart Handler Functions
  const handleAddToCart = (product) => {
    if (product.stock <= 0) {
      alert("Item is out of stock!");
      return;
    }

    setCart((prevCart) => {
      const existing = prevCart.find((item) => item.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) {
          alert(`Cannot add more than remaining stock (${product.stock})`);
          return prevCart;
        }
        return prevCart.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prevCart, {
        id: product.id,
        name: product.name,
        unitPrice: Number(product.sellingPrice) || 0,
        quantity: 1,
        category: product.category
      }];
    });
  };

  const handleUpdateQuantity = (id, delta) => {
    const targetProduct = products.find(p => p.id === id);

    setCart((prevCart) =>
      prevCart
        .map((item) => {
          if (item.id === id) {
            const newQty = item.quantity + delta;
            if (targetProduct && newQty > targetProduct.stock) {
              alert(`Cannot exceed available stock of ${targetProduct.stock}`);
              return item;
            }
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean)
    );
  };

  const handleRemoveItem = (id) => {
    setCart((prevCart) => prevCart.filter((item) => item.id !== id));
  };

  const handleClearCart = () => {
    setCart([]);
    setDiscountPercent(0);
    setDiscountApproval(null);
  };

  // FEATURE 1: Discount Modal — opening syncs both fields to the currently applied discount
  const handleOpenDiscountModal = () => {
    const pct = discountPercent || 0;
    setTempDiscountPercent(pct);
    setTempDiscountAmount(subtotal > 0 ? Number(((subtotal * pct) / 100).toFixed(2)) : 0);
    setSupervisorPin("");
    setDiscountError("");
    setShowDiscountModal(true);
  };

  // Editing the percentage recalculates the fixed value from the live subtotal
  const handlePercentInput = (value) => {
    const pct = Math.min(100, Math.max(0, Number(value) || 0));
    setTempDiscountPercent(pct);
    setTempDiscountAmount(subtotal > 0 ? Number(((subtotal * pct) / 100).toFixed(2)) : 0);
  };

  // Editing the fixed value recalculates the percentage from the live subtotal
  const handleAmountInput = (value) => {
    const amt = Math.min(subtotal, Math.max(0, Number(value) || 0));
    setTempDiscountAmount(amt);
    setTempDiscountPercent(subtotal > 0 ? Number(((amt / subtotal) * 100).toFixed(2)) : 0);
  };

  // FEATURE 1: Discount Authorization Logic — the server verifies the supervisor PIN and
  // returns an approval token that checkout must present for the discounted sale.
  const handleApplyDiscount = async () => {
    if (subtotal <= 0) {
      setDiscountError("Add items to the cart before applying a discount.");
      return;
    }
    if (tempDiscountPercent <= 0) {
      // Removing a discount needs no approval.
      setDiscountPercent(0);
      setDiscountApproval(null);
      setShowDiscountModal(false);
      return;
    }
    if (isApproving) return;
    setIsApproving(true);
    setDiscountError("");
    try {
      const approval = await requestApproval({
        pin: supervisorPin,
        action: 'DISCOUNT',
        discountPercent: tempDiscountPercent,
      });
      setDiscountPercent(tempDiscountPercent);
      setDiscountApproval(approval);
      setShowDiscountModal(false);
      setSupervisorPin("");
    } catch (err) {
      setDiscountError(err.message);
    } finally {
      setIsApproving(false);
    }
  };

  // FEATURE 2: Park/Hold Sale Logic
  const handleHoldSale = () => {
    if (cart.length === 0) return;
    const newPendingOrder = {
      id: `PEND-${Date.now().toString().slice(-4)}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      cart: [...cart],
      discountPercent,
      discountApproval,
      total: cartTotal
    };
    setPendingSales((prev) => [...prev, newPendingOrder]);
    handleClearCart();
  };

  const handleRestorePendingSale = (pendingOrder) => {
    setCart(pendingOrder.cart);
    setDiscountPercent(pendingOrder.discountPercent);
    setDiscountApproval(pendingOrder.discountApproval || null);
    setPendingSales((prev) => prev.filter((o) => o.id !== pendingOrder.id));
    setShowPendingModal(false);
  };

  // SUBMIT CONFIRMED TRANSACTION TO BACKEND
const handleConfirmSale = async () => {
  if (cart.length === 0) {
    alert("Cart is empty!");
    return;
  }

  // Calculate reliable values inline to prevent state mismatch
  const currentSubtotal = cart.reduce(
    (sum, item) => sum + Number(item.unitPrice) * item.quantity,
    0
  );
  const currentDiscountAmount = (currentSubtotal * discountPercent) / 100;
  const currentTotalAmount = Math.max(0, currentSubtotal - currentDiscountAmount);

  // Sanitize Enum value ("E-wallet" -> "E_WALLET")
  const formattedPaymentMethod = paymentMethod
    .toUpperCase()
    .replace('-', '_')
    .replace(' ', '_');

  // The server recomputes every price and total from the database; the client only
  // names the products, quantities, discount %, and the supervisor approval token.
  // totalAmount is sent so the server can flag a price that changed under the cashier.
  const payload = {
    items: cart.map((item) => ({
      productId: Number(item.id),
      quantity: Number(item.quantity),
    })),
    discountPercent: Number(discountPercent),
    totalAmount: Number(currentTotalAmount.toFixed(2)),
    paymentMethod: formattedPaymentMethod, // "CASH", "CARD", "E_WALLET"
    approvalToken: discountPercent > 0 ? discountApproval?.token : undefined,
  };

  try {
    const response = await fetch('http://localhost:5000/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });

    const responseData = await response.json();

    if (response.ok) {
      // The backend prints the receipt automatically (silently, no dialog)
      // right after saving the transaction — this in-app screen is just the
      // cashier-facing confirmation, replacing the native browser alert().
      setLastSale({
        items: cart.map((item) => ({ ...item })),
        subtotal: Number(responseData.subtotal),
        discountPercent,
        discountAmount: Number(responseData.discountAmount),
        total: Number(responseData.totalAmount),
        paymentMethod,
      });
      setShowSuccessModal(true);

      handleClearCart();
      fetchProducts(); // Refresh stock counts from server
    } else if (response.status === 401) {
      handleStaleSession();
    } else if (responseData.code === 'INSUFFICIENT_STOCK' || responseData.code === 'PRICE_CHANGED') {
      alert(responseData.error);
      fetchProducts(); // Pull the latest stock and prices so the cart can be fixed
    } else if (responseData.code === 'APPROVAL_INVALID' || responseData.code === 'APPROVAL_REQUIRED') {
      // The supervisor approval expired or was already used — the discount must be re-authorized.
      setDiscountPercent(0);
      setDiscountApproval(null);
      alert(`${responseData.error} The discount was removed; apply it again with the supervisor PIN.`);
    } else {
      console.error('Server error details:', responseData);
      alert(`Transaction failed: ${responseData.message || responseData.error || 'Server error'}`);
    }
  } catch (err) {
    console.error('Checkout network error:', err);
    alert("Error connecting to server! Check backend connection at http://localhost:5000");
  }
};

  // FEATURE 3: EOD RECONCILIATION API
  // Today's X-Reading figures for this cashier, computed by the server. Needs the
  // supervisor approval token issued when the gate was unlocked.
  const fetchExpectedCash = async (approvalToken) => {
    const res = await apiFetch('http://localhost:5000/api/reconciliation/expected-cash', {
      headers: { 'X-Approval-Token': approvalToken },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to load X-Reading figures.');

    setExpectedSales(Number(data.expectedCash) || 0);
    setEodFigures({
      gross: Number(data.grossSales) || 0,
      discount: Number(data.totalDiscount) || 0,
      net: Number(data.netSales) || 0,
    });
    setEodClosedReportNo(data.alreadyClosed ? data.closedReportNo : null);
  };

  // Exports a saved reconciliation record, or a preview built from the live figures.
  const handleExportReport = (savedRecord = null) => {
    if (savedRecord) {
      exportCsv(savedRecord);
      return;
    }
    exportCsv({
      reportNo: `PREVIEW-${Math.floor(1000 + Math.random() * 9000)}`,
      createdAt: new Date().toISOString(),
      cashier: { username: user?.username || 'Cashier' },

      grossSales: eodFigures.gross,
      pointsAvailed: 0.00,
      totalDiscount: eodFigures.discount,
      netSales: eodFigures.net,

      ...cashDenominations,

      posCash: expectedSales,
      cashDiscount: 0.00,
      cashierCash: totalCountedCash,
      shortOver: shortOver,
    });
  };

  // Opening X-Reading/EOD always starts at the supervisor gate — the
  // denomination grid itself only renders once eodUnlocked flips true.
  const handleOpenEODModal = () => {
    setEodSupervisorPin("");
    setEodAuthError("");
    setShowEODAuthModal(true);
  };

  const handleAuthorizeEOD = async () => {
    if (isApproving) return;
    setIsApproving(true);
    setEodAuthError("");
    try {
      const approval = await requestApproval({ pin: eodSupervisorPin, action: 'XREAD' });
      await fetchExpectedCash(approval.token);
      setEodApprovalToken(approval.token);
      setEodUnlocked(true);
      setShowEODAuthModal(false);
      setEodSupervisorPin("");
      setShowEODModal(true);
    } catch (err) {
      setEodAuthError(err.message);
    } finally {
      setIsApproving(false);
    }
  };

  const handleCloseEODModal = () => {
    setShowEODModal(false);
    setEodUnlocked(false);
    setEodApprovalToken(null);
  };

  const handleSubmitReconciliation = async () => {
    // Defense-in-depth: the grid can only be reached via handleAuthorizeEOD,
    // but re-check before writing the day's reconciliation record too.
    if (!eodUnlocked || !eodApprovalToken) {
      setShowEODModal(false);
      setEodAuthError("Supervisor authorization required.");
      setShowEODAuthModal(true);
      return;
    }

    // Totals, expected cash and the BALANCED/SHORTAGE/OVERAGE status are all computed
    // by the server; only the counted denominations are sent.
    try {
      const res = await fetch('http://localhost:5000/api/reconciliation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Approval-Token': eodApprovalToken,
        },
        body: JSON.stringify({ denominations: cashDenominations }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        alert(`Reconciliation saved (${data.record.status}).`);
        handleExportReport(data.record);
        handleCloseEODModal();
        setCashDenominations({ p1000: 0, p500: 0, p200: 0, p100: 0, p50: 0, p20: 0, p10: 0, p5: 0, p1: 0, c25: 0 });
      } else if (res.status === 401) {
        handleStaleSession();
      } else if (data.code === 'APPROVAL_INVALID' || data.code === 'APPROVAL_REQUIRED') {
        alert(`${data.error} Please unlock X-Reading again.`);
        handleCloseEODModal();
      } else {
        alert(data.error || 'Failed to save reconciliation record.');
        if (data.code === 'ALREADY_CLOSED') fetchExpectedCash(eodApprovalToken).catch(() => {});
      }
    } catch (err) {
      console.error('Submission error:', err);
      alert('Server error connecting to database.');
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-gradient-to-br from-slate-100 via-blue-50/60 to-indigo-50/40 font-bold text-slate-500">
        Loading inventory...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-screen w-full items-center justify-center bg-gradient-to-br from-slate-100 via-blue-50/60 to-indigo-50/40 gap-2">
        <p className="text-rose-600 font-bold">Failed to load inventory: {error}</p>
        <button onClick={fetchProducts} className="px-5 py-2 bg-[#0B132B] hover:shadow-slate-900/30 shadow-lg text-white rounded-full text-xs font-bold cursor-pointer transition-all">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen lg:h-screen w-full bg-gradient-to-br from-slate-100 via-blue-50/60 to-indigo-50/40 p-3 md:p-5 flex gap-3 md:gap-4 overflow-y-auto lg:overflow-hidden font-sans box-border">

      {/* MAIN DASHBOARD SHELL — single canvas, no separate sidebar */}
      <div className="flex-1 flex flex-col bg-white/80 rounded-3xl shadow-sm border border-indigo-100 p-4 md:p-6 min-h-0 lg:overflow-visible">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <img src="/aski.png" alt="ASKI Logo" className="h-8 w-auto shrink-0" />
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold text-slate-900 truncate">{getGreeting()}, {user?.username || 'Cashier'}</h1>
              <p className="hidden sm:block text-xs text-slate-400 mt-0.5">ASKI Multi-Coop &middot; Cashier POS Terminal</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPendingModal(true)}
              className="relative flex items-center gap-1.5 bg-white border border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-blue-600 px-3 sm:px-3.5 py-2 rounded-full text-xs font-bold transition-colors cursor-pointer"
            >
              <Clock className="w-4 h-4" />
              <span className="hidden sm:inline">Pending Sales</span>
              {pendingSales.length > 0 && (
                <span className="ml-0.5 bg-[#0B132B] text-white rounded-full text-[9px] w-4 h-4 flex items-center justify-center">
                  {pendingSales.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={handleOpenEODModal}
              className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-blue-600 px-3 sm:px-3.5 py-2 rounded-full text-xs font-bold transition-colors cursor-pointer"
            >
              <Banknote className="w-4 h-4" />
              <span className="hidden sm:inline">X-Reading / EOD</span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-500 hover:border-rose-300 hover:text-rose-500 px-3 sm:px-3.5 py-2 rounded-full text-xs font-bold transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Logout</span>
            </button>
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#0B132B] flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-sm">
              {(user?.username || "C").charAt(0).toUpperCase()}
            </div>
          </div>
        </div>

        {/* Quick stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5 shrink-0">
          <StatCard icon={ShoppingCart} color="indigo" label="Items in Cart" value={cartItemCount} />
          <StatCard icon={Wallet} color="emerald" label="Cart Subtotal" value={`PHP ${subtotal.toFixed(2)}`} />
          <StatCard icon={Clock} color="amber" label="On Hold" value={pendingSales.length} />
          <StatCard icon={Package} color="violet" label="In Catalog" value={products.length} />
        </div>

        {/* Content: catalog + order panel */}
        <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0">

          {/* LEFT: PRODUCT CATALOG */}
          <div className="flex-1 flex flex-col min-h-[520px] lg:min-h-0 bg-indigo-50/40 rounded-2xl p-4 border border-indigo-100">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h2 className="text-sm font-bold text-slate-800">Product Catalog</h2>
              <ChevronDown className="w-4 h-4 text-slate-400" />
            </div>

            {/* Controls Bar */}
            <div className="flex flex-wrap items-center gap-2 mb-3 shrink-0">
              <button
                onClick={() => setSelectedCategory("All")}
                className={`px-4 py-2 rounded-full font-semibold transition-all text-xs cursor-pointer ${selectedCategory === "All"
                  ? "bg-[#0B132B] text-white shadow-md shadow-slate-900/20"
                  : "bg-white border border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600"
                  }`}
              >
                All Products
              </button>

              {/* Custom dropdown with category icons */}
              <div className="relative" ref={categoryMenuRef}>
                <button
                  type="button"
                  onClick={() => setCategoryMenuOpen((o) => !o)}
                  className="flex items-center gap-2 bg-white border border-slate-200 text-slate-600 pl-3 pr-3 py-2 rounded-xl text-xs font-medium hover:border-indigo-300 transition-colors cursor-pointer"
                >
                  {selectedCategory === "All" ? (
                    <LayoutGrid className="w-3.5 h-3.5 text-blue-500" />
                  ) : (
                    <CategoryIcon category={selectedCategory} className="w-3.5 h-3.5 text-blue-500" />
                  )}
                  {selectedCategory === "All" ? "Select Category" : selectedCategory}
                  <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${categoryMenuOpen ? "rotate-180" : ""}`} />
                </button>

                {categoryMenuOpen && (
                  <div className="absolute top-full left-0 mt-2 min-w-[200px] w-max max-w-xs bg-white border border-slate-200 rounded-xl shadow-xl z-30 py-1.5 max-h-64 overflow-y-auto">
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
                            className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${active ? "bg-blue-50 text-blue-600" : "text-slate-600 hover:bg-slate-50"}`}
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

              <div className="relative w-full sm:flex-1 sm:max-w-xs sm:ml-auto">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search products..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-white text-slate-700 border border-slate-200 pl-9 pr-4 py-2 rounded-full text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 placeholder-slate-400 transition-all"
                />
              </div>
            </div>

            {/* Product Grid */}
            <div className="flex-1 bg-white/80 rounded-2xl p-3 overflow-y-auto min-h-0 border border-indigo-100 shadow-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {filteredProducts.map((product) => (
                  <div
                    key={product.id}
                    onClick={() => handleAddToCart(product)}
                    className="bg-white/90 rounded-2xl p-3 flex flex-col justify-between cursor-pointer border border-indigo-100/80 shadow-sm hover:border-blue-400 hover:shadow-lg hover:shadow-indigo-500/10 hover:-translate-y-0.5 transition-all duration-200"
                  >
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-100/60 rounded-xl h-20 w-full flex items-center justify-center mb-2.5">
                      <div className="bg-white/80 p-3 rounded-full shadow-sm">
                        <CategoryIcon category={product.category} className="w-5 h-5 text-indigo-600" />
                      </div>
                    </div>
                    <div className="text-slate-800 font-medium text-xs">
                      <div className="truncate font-semibold text-slate-900">{product.name}</div>
                      <div className="flex justify-between items-center mt-1.5">
                        <span className="text-slate-900 font-bold">
                          PHP {Number(product.sellingPrice || 0).toFixed(2)}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${product.stock > 0 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
                          Stock: {product.stock}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT: ORDER DETAILS */}
          <div className="w-full lg:w-80 xl:w-96 flex flex-col gap-3 min-h-[520px] lg:min-h-0 lg:h-full shrink-0">

            {/* Hero total card — kept compact so it doesn't crowd the cart below */}
            <div className="relative overflow-hidden bg-[#0B132B] rounded-2xl p-3 text-white shrink-0 shadow-lg shadow-slate-900/30">
              <div className="relative z-10 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium text-white/60">Amount Due</p>
                  <p className="text-lg font-extrabold mt-0.5 truncate">
                    PHP {cartTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className="text-[10px] text-white/50">Subtotal: PHP {subtotal.toFixed(2)}</p>
                </div>

                <div className="relative w-11 h-11 shrink-0">
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{ background: `conic-gradient(#22d3ee ${Math.min(100, discountPercent) * 3.6}deg, rgba(255,255,255,0.15) 0deg)` }}
                  />
                  <div className="absolute inset-[4px] bg-[#0B132B] rounded-full flex items-center justify-center">
                    <span className="text-[10px] font-bold text-cyan-300">{discountPercent}%</span>
                  </div>
                </div>
              </div>

              <button
                onClick={handleOpenDiscountModal}
                className="relative z-10 mt-2 w-full flex items-center justify-center gap-1.5 bg-white/10 hover:bg-white/20 rounded-full py-1.5 text-[11px] font-bold transition-colors cursor-pointer backdrop-blur-sm"
              >
                <Percent className="w-3 h-3 text-cyan-300" />
                {discountPercent > 0 ? "Change Discount" : "Apply Supervisor Discount"}
              </button>

              {discountPercent > 0 && (
                <p className="relative z-10 text-[10px] text-emerald-400 font-semibold mt-1.5 text-center">
                  Discount applied: - PHP {discountAmount.toFixed(2)}
                </p>
              )}

              <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none" />
            </div>

            {/* Cart list card */}
            <div className="flex-1 bg-slate-50/80 rounded-2xl border border-slate-200/80 shadow-sm p-4 flex flex-col min-h-0">
              <div className="flex justify-between items-center mb-2 shrink-0">
                <h2 className="text-sm font-bold text-slate-900">Order Details</h2>
                <button
                  onClick={handleHoldSale}
                  disabled={cart.length === 0}
                  className="text-[11px] font-bold text-amber-600 bg-amber-50 hover:bg-amber-100 px-2.5 py-1 rounded-full transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Hold Sale
                </button>
              </div>
              <hr className="border-slate-100 mb-2 shrink-0" />

              {/* Cart Item List */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 mb-3 min-h-0">
                {cart.length === 0 ? (
                  <div className="text-center py-6 text-slate-400 text-xs">Cart is empty</div>
                ) : (
                  cart.map((item) => (
                    <div
                      key={item.id}
                      className="bg-white rounded-xl p-2.5 border border-indigo-100 shadow-sm hover:shadow-md hover:border-blue-200 transition-all duration-200 flex items-center gap-2.5 text-xs"
                    >
                      <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-50 to-indigo-100/60 flex items-center justify-center shrink-0">
                        <CategoryIcon category={item.category} className="w-4 h-4 text-indigo-600" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <h4 className="font-semibold text-slate-800 text-xs truncate">{item.name}</h4>
                        <span className="text-[11px] text-slate-500 font-medium">
                          PHP {Number(item.unitPrice || 0).toFixed(2)} each
                        </span>
                      </div>

                      <div className="text-right flex flex-col items-end gap-1 shrink-0">
                        <span className="font-bold text-xs text-slate-900">
                          PHP {(Number(item.unitPrice || 0) * item.quantity).toFixed(2)}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <div className="flex items-center gap-1 bg-slate-50 px-1 py-0.5 rounded-full border border-slate-200">
                            <button onClick={() => handleUpdateQuantity(item.id, -1)} className="text-blue-500 hover:text-blue-700 p-0.5 cursor-pointer">
                              <Minus className="w-2.5 h-2.5" />
                            </button>
                            <span className="font-semibold text-[11px] px-0.5 min-w-[10px] text-center text-slate-800">
                              {item.quantity}
                            </span>
                            <button onClick={() => handleUpdateQuantity(item.id, 1)} className="text-blue-500 hover:text-blue-700 p-0.5 cursor-pointer">
                              <Plus className="w-2.5 h-2.5" />
                            </button>
                          </div>
                          <button onClick={() => handleRemoveItem(item.id)} className="w-5 h-5 flex items-center justify-center rounded-full bg-rose-50 text-rose-500 hover:bg-rose-100 hover:text-rose-600 cursor-pointer transition-colors shrink-0">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Payment Options */}
              <div className="mb-3 shrink-0">
                <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">
                  Payment Method
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {["Cash", "Card", "E-wallet"].map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentMethod(method)}
                      className={`py-2 rounded-xl text-[11px] font-bold transition-all cursor-pointer ${paymentMethod === method
                        ? "bg-[#0B132B] text-cyan-300 shadow-md shadow-slate-900/20"
                        : "bg-slate-50 border border-slate-200 text-slate-500 hover:border-indigo-300"
                        }`}
                    >
                      {method}
                    </button>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-2 shrink-0">
                <button
                  onClick={handleClearCart}
                  className="py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-full transition-colors cursor-pointer"
                >
                  Clear
                </button>
                <button
                  onClick={handleConfirmSale}
                  disabled={cart.length === 0}
                  className="py-2.5 bg-[#0B132B] hover:shadow-slate-900/30 shadow-lg text-white text-xs font-bold rounded-full transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                >
                  Confirm
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* --- MODAL 1: SUPERVISOR DISCOUNT (BI-DIRECTIONAL % / VALUE) --- */}
      {showDiscountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xs border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Lock className="w-4 h-4 text-[#0B132B]" />
                Supervisor Discount
              </h3>
              <button onClick={() => setShowDiscountModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">Percentage (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={tempDiscountPercent === 0 ? '' : tempDiscountPercent}
                    placeholder="0"
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => handlePercentInput(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">Value (₱)</label>
                  <input
                    type="number"
                    min="0"
                    max={subtotal}
                    step="0.01"
                    value={tempDiscountAmount === 0 ? '' : tempDiscountAmount}
                    placeholder="0"
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => handleAmountInput(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-all"
                  />
                </div>
              </div>
              <p className="text-[10px] text-slate-400 font-medium">
                Subtotal: PHP {subtotal.toFixed(2)} — editing either field recalculates the other.
              </p>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Supervisor PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Enter supervisor PIN"
                  value={supervisorPin}
                  onChange={(e) => setSupervisorPin(e.target.value.replace(/[^0-9]/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && handleApplyDiscount()}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-all"
                />
              </div>

              {discountError && (
                <div className="p-2.5 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 text-xs font-semibold">
                  {discountError}
                </div>
              )}
            </div>

            <div className="p-5 border-t border-slate-100">
              <button
                onClick={handleApplyDiscount}
                disabled={isApproving}
                className="w-full py-2.5 disabled:opacity-60 bg-[#0B132B] hover:shadow-slate-900/30 shadow-lg text-white rounded-full text-xs font-bold transition-all cursor-pointer"
              >
                {isApproving ? 'Verifying…' : 'Authorize & Apply'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL 2: PENDING SALES AREA --- */}
      {showPendingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md border border-slate-100 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 shrink-0">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#0B132B]" />
                Pending Sales Queue
              </h3>
              <button onClick={() => setShowPendingModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 max-h-60 overflow-y-auto space-y-2">
              {pendingSales.length === 0 ? (
                <p className="text-center text-xs text-slate-400 py-6">No sales on hold</p>
              ) : (
                pendingSales.map((item) => (
                  <div key={item.id} className="p-3 bg-amber-50 border border-amber-100 rounded-xl flex items-center justify-between text-xs">
                    <div>
                      <div className="font-bold text-slate-800">{item.id} ({item.timestamp})</div>
                      <div className="text-slate-500 text-[11px]">{item.cart.length} item(s)</div>
                      <div className="font-semibold text-slate-900 mt-0.5">PHP {item.total.toFixed(2)}</div>
                    </div>
                    <button
                      onClick={() => handleRestorePendingSale(item)}
                      className="px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:shadow-amber-500/20 shadow-md text-white rounded-full font-bold text-xs cursor-pointer"
                    >
                      Resume
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL 3: SUPERVISOR AUTHORIZATION GATE FOR X-READING / EOD --- */}
      {showEODAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xs border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#0B132B]" />
                Supervisor Authorization
              </h3>
              <button onClick={() => setShowEODAuthModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-500 font-medium">
                Enter a supervisor PIN to access X-Reading / EOD reconciliation.
              </p>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Supervisor PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  placeholder="Enter supervisor PIN"
                  value={eodSupervisorPin}
                  onChange={(e) => setEodSupervisorPin(e.target.value.replace(/[^0-9]/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && handleAuthorizeEOD()}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-all"
                />
              </div>

              {eodAuthError && (
                <div className="p-2.5 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 text-xs font-semibold">
                  {eodAuthError}
                </div>
              )}
            </div>

            <div className="p-5 border-t border-slate-100 flex justify-end gap-2">
              <button
                onClick={() => setShowEODAuthModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-full transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleAuthorizeEOD}
                disabled={isApproving}
                className="px-4 py-2 disabled:opacity-60 bg-[#0B132B] hover:shadow-slate-900/30 shadow-lg text-white font-bold text-xs rounded-full transition-all cursor-pointer"
              >
                {isApproving ? 'Verifying…' : 'Unlock'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL 4: END OF DAY / X-READING RECONCILIATION (supervisor-gated) --- */}
      {showEODModal && eodUnlocked && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
          onClick={(e) => e.target === e.currentTarget && handleCloseEODModal()}
        >
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg border border-slate-100 max-h-[90vh] flex flex-col">

            {/* Header */}
            <div className="flex justify-between items-center p-5 border-b border-slate-100 shrink-0">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Banknote className="w-4 h-4 text-[#0B132B]" />
                X-Reading / Cashier Accountability
              </h3>
              <button
                onClick={handleCloseEODModal}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3 min-h-0">
              {eodClosedReportNo && (
                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs font-semibold">
                  Today's register was already closed (report {eodClosedReportNo}). You can review the figures but not submit again.
                </div>
              )}
              <p className="text-xs text-slate-500 font-medium">Input physical cash denomination quantities:</p>

              {/* DENOMINATIONS INPUT GRID */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {[
                  { label: "₱1,000.00 Note", key: "p1000" },
                  { label: "₱500.00 Note", key: "p500" },
                  { label: "₱200.00 Note", key: "p200" },
                  { label: "₱100.00 Note", key: "p100" },
                  { label: "₱50.00 Note", key: "p50" },
                  { label: "₱20.00 Note", key: "p20" },
                  { label: "₱10.00 Coin", key: "p10" },
                  { label: "₱5.00 Coin", key: "p5" },
                  { label: "₱1.00 Coin", key: "p1" },
                  { label: "₱0.25 Coin", key: "c25" },
                ].map((denom) => (
                  <div key={denom.key} className="flex items-center justify-between p-2 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="font-semibold text-slate-700">{denom.label}</span>
                    <input
                      type="number"
                      min="0"
                      value={cashDenominations[denom.key] === 0 ? '' : cashDenominations[denom.key]}
                      placeholder="0"
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => handleDenominationChange(denom.key, e.target.value)}
                      className="w-16 border border-slate-200 rounded-lg p-1 text-center font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 bg-white transition-all"
                    />
                  </div>
                ))}
              </div>

              {/* Reconciliation Audit Box */}
              <div className="p-3 bg-indigo-50/60 rounded-xl space-y-1.5 text-xs border border-indigo-100">
                <div className="flex justify-between font-medium text-slate-600">
                  <span>Cashier Cash (Counted):</span>
                  <span className="font-bold text-slate-800">
                    PHP {totalCountedCash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between font-medium text-slate-600">
                  <span>POS Cash (Expected):</span>
                  <span className="font-bold text-slate-800">
                    PHP {expectedSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between font-bold border-t border-indigo-200 pt-1 text-sm">
                  <span>Short / Over:</span>
                  <span className={shortOver < 0 ? "text-rose-600" : shortOver > 0 ? "text-emerald-600" : "text-slate-800"}>
                    PHP {shortOver.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="grid grid-cols-2 gap-2 shrink-0 p-5 border-t border-slate-100">
              <button
                type="button"
                onClick={() => handleExportReport()}
                className="py-2.5 bg-white hover:bg-slate-50 text-[#0B132B] border border-slate-200 rounded-full text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Export X-Reading
              </button>

              <button
                type="button"
                onClick={handleSubmitReconciliation}
                disabled={!!eodClosedReportNo}
                className="py-2.5 disabled:opacity-40 disabled:cursor-not-allowed bg-[#0B132B] hover:shadow-slate-900/30 shadow-lg text-white rounded-full text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                Submit Reconciliation
              </button>
            </div>

          </div>
        </div>
      )}

      {/* --- MODAL 5: CHECKOUT SUCCESS (custom in-app confirmation, replaces the native browser alert) --- */}
      {showSuccessModal && lastSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm border border-slate-100 max-h-[90vh] flex flex-col overflow-hidden">

            <div className="relative overflow-hidden bg-[#0B132B] px-6 pt-7 pb-6 text-center shrink-0">
              <div className="absolute -top-8 -right-8 w-28 h-28 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
              <div className="relative z-10 mx-auto w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center mb-3">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              </div>
              <h3 className="relative z-10 text-white font-extrabold text-base">Payment Successful</h3>
              <p className="relative z-10 text-white/60 text-[11px] mt-1">Transaction recorded &amp; receipt printed</p>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <div className="text-center">
                <p className="text-[11px] text-slate-400 font-medium">Total Amount</p>
                <p className="text-2xl font-extrabold text-slate-900 mt-0.5">
                  PHP {lastSale.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>

              <div className="border border-slate-100 rounded-xl divide-y divide-slate-100">
                {lastSale.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between px-3 py-2 text-xs">
                    <span className="text-slate-600 font-medium truncate mr-2">{item.name} &times;{item.quantity}</span>
                    <span className="font-semibold text-slate-800 shrink-0">
                      PHP {(Number(item.unitPrice || 0) * item.quantity).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="bg-slate-50 rounded-xl p-3 space-y-1 text-xs">
                <div className="flex justify-between text-slate-500 font-medium">
                  <span>Subtotal</span>
                  <span>PHP {lastSale.subtotal.toFixed(2)}</span>
                </div>
                {lastSale.discountPercent > 0 && (
                  <div className="flex justify-between text-emerald-600 font-semibold">
                    <span>Discount ({lastSale.discountPercent}%)</span>
                    <span>- PHP {lastSale.discountAmount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-500 font-medium">
                  <span>Payment Method</span>
                  <span className="font-bold text-slate-800">{lastSale.paymentMethod}</span>
                </div>
              </div>
            </div>

            <div className="p-5 border-t border-slate-100 shrink-0">
              <button
                onClick={() => setShowSuccessModal(false)}
                className="w-full py-2.5 bg-[#0B132B] hover:shadow-slate-900/30 shadow-lg text-white rounded-full text-xs font-bold transition-all cursor-pointer"
              >
                New Sale
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
