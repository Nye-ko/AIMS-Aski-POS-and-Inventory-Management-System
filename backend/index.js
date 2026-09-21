BigInt.prototype.toJSON = function () {
  return Number(this);
};

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const cron = require('node-cron');

// Import Models
const { ProductModel, ProductError, ADJUSTMENT_REASONS, prisma } = require('./models/Product');
const { StockMovementModel, STOCK_MOVEMENT_TYPES } = require('./models/StockMovement');
const TransactionModel = require('./models/Transaction');
const ReconciliationModel = require('./models/Reconciliation');
const DashboardModel = require('./models/Dashboard');
const DemandForecastModel = require('./models/DemandForecast');
const ForecastAccuracyModel = require('./models/ForecastAccuracy');
const FinanceModel = require('./models/FinanceModel');
const { PurchaseOrderModel, PurchasingError } = require('./models/PurchaseOrder');
const { buildPurchaseOrderWorkbook } = require('./services/purchaseOrderExcel');
const { ReceivingReportModel } = require('./models/ReceivingReport');
const { buildReceivingReportWorkbook } = require('./services/receivingReportExcel');
const { PurchaseReturnModel } = require('./models/PurchaseReturn');
const { buildPurchaseReturnWorkbook } = require('./services/purchaseReturnExcel');
const {
  AuthModel,
  authenticateToken,
  requireRole,
  authenticateSocketToken,
  STALE_SESSION_ERROR,
} = require('./models/Auth');
const { UserModel, UserError } = require('./models/User');
const { AuditLogModel, AUDIT_ACTIONS } = require('./models/AuditLog');

// Import Services
const mailer = require('./services/mailer');
const lowStockAlerts = require('./services/lowStockAlerts');
const expiryAlerts = require('./services/expiryAlerts');
const forecastAlerts = require('./services/forecastAlerts');
const forecastSnapshots = require('./services/forecastSnapshots');
const receiptPrinter = require('./services/receiptPrinter');
const posApproval = require('./services/posApproval');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  },
});

app.set('io', io);

// Only logged-in, active users may open a socket. Finance broadcasts go to a
// role-scoped room so cashiers/inventory staff never receive them.
io.use(async (socket, next) => {
  const user = await authenticateSocketToken(socket.handshake.auth && socket.handshake.auth.token);
  if (!user) return next(new Error('Authentication required.'));
  socket.data.user = user;
  next();
});

// Role groups shared by the route guards below (ADMIN is always allowed by requireRole).
const ROLES = {
  POS: ['CASHIER', 'SUPERVISOR'],
  DASHBOARD: ['SUPERVISOR', 'INVENTORY', 'ACCOUNTING'],
  INVENTORY_READ: ['SUPERVISOR', 'INVENTORY'],
  INVENTORY_WRITE: ['INVENTORY'],
  PRODUCT_LOOKUP: ['CASHIER', 'SUPERVISOR', 'INVENTORY'],
  FORECAST: ['INVENTORY', 'ACCOUNTING'],
  FINANCE: ['ACCOUNTING'],
  RECONCILIATION_WRITE: ['CASHIER', 'SUPERVISOR', 'ACCOUNTING'],
  RECONCILIATION_READ: ['SUPERVISOR', 'ACCOUNTING'],
};

const FINANCE_ROOM = 'finance';
const DASHBOARD_ROOM = 'dashboard';

io.on('connection', (socket) => {
  const { role } = socket.data.user;
  if (role === 'ADMIN' || ROLES.FINANCE.includes(role)) socket.join(FINANCE_ROOM);
  if (role === 'ADMIN' || ROLES.DASHBOARD.includes(role)) socket.join(DASHBOARD_ROOM);
  console.log('Client connected to WebSocket:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// --- ROUTES ---

// --- AUTH ROUTES ---
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await AuthModel.login(username, password);
    res.json(result);
  } catch (error) {
    res.status(error.status || 401).json({ error: error.message || 'Login failed' });
  }
});

// Self-service password change (any signed-in user). Requires the current password.
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    await UserModel.changePassword(req.user.id, req.body.currentPassword, req.body.newPassword);
    res.json({ changed: true });
  } catch (error) {
    if (!(error instanceof UserError)) console.error('Error changing password:', error);
    const known = error instanceof UserError;
    res.status(known ? error.status : 500).json({ error: known ? error.message : 'Failed to change password' });
  }
});

// Lets the frontend verify a stored token is still valid (e.g. on page reload).
app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// Re-verifies the caller's own password. Used to gate sensitive admin screens
// (e.g. User Management) behind a fresh password prompt on top of the session JWT.
app.post('/api/auth/verify-password', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    await AuthModel.verifyPassword(req.user.id, req.body.password);
    res.json({ valid: true });
  } catch (error) {
    res.status(error.status || 401).json({ error: error.message || 'Invalid admin password. Access denied.' });
  }
});

// Only admins may manage user accounts. Must run after authenticateToken so req.user is set.
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

// --- USER MANAGEMENT ROUTES (admin only) ---
app.get('/api/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await UserModel.findAll();
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/api/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { fullName, username, password, role } = req.body;
    const user = await UserModel.create({ fullName, username, password, role }, req.user);
    res.status(201).json(user);
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(400).json({ error: error.message || 'Failed to create user' });
  }
});

app.patch('/api/users/:id/role', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const user = await UserModel.updateRole(req.params.id, req.body.role, req.user);
    res.json(user);
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(400).json({ error: error.message || 'Failed to update role' });
  }
});

app.patch('/api/users/:id/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const user = await UserModel.setActive(req.params.id, req.body.isActive, req.user);
    res.json(user);
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(400).json({ error: error.message || 'Failed to update status' });
  }
});

// Set (body: { pin: "1234" }) or clear (body: { pin: null }) a supervisor's POS approval PIN.
app.put('/api/users/:id/pin', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pin = req.body.pin === null ? null : String(req.body.pin ?? '');
    const user = await UserModel.setPin(req.params.id, pin, req.user);
    res.json(user);
  } catch (error) {
    console.error('Error updating user PIN:', error);
    res.status(400).json({ error: error.message || 'Failed to update PIN' });
  }
});

app.post('/api/users/:id/reset-password', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await UserModel.resetPassword(req.params.id, req.user);
    res.json(result);
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(400).json({ error: error.message || 'Failed to reset password' });
  }
});

// Admin activity log (newest first). Filters: action, targetUserId, actorId, from, to (dates), limit, before (last id loaded).
app.get('/api/audit-log', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (req.query.action && !AUDIT_ACTIONS.includes(req.query.action)) {
      return res.status(400).json({ error: `action must be one of: ${AUDIT_ACTIONS.join(', ')}` });
    }
    res.json(await AuditLogModel.findAll(req.query));
  } catch (error) {
    console.error('Error fetching audit log:', error);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// 1. Get All Products (Includes supplier relations and computed status)
app.get('/api/products', authenticateToken, requireRole(...ROLES.PRODUCT_LOOKUP), async (req, res) => {
  try {
    const products = await ProductModel.findAll();
    res.json(products);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Maps product/inventory failures onto HTTP: typed errors carry their own status, anything
// unexpected is a generic 500.
const sendProductError = (res, error, action) => {
  console.error(`Error ${action}:`, error);
  if (error instanceof ProductError) return res.status(error.status).json({ error: error.message });
  return res.status(500).json({ error: `Failed to ${action}` });
};

// 2. Create New Product (any starting stock is logged as an OPENING movement)
app.post('/api/products', authenticateToken, requireRole(...ROLES.INVENTORY_WRITE), async (req, res) => {
  try {
    const product = await ProductModel.create(req.body, req.user.id);
    res.status(201).json(product);
  } catch (error) {
    sendProductError(res, error, 'create product');
  }
});

// 2b. Update a product (expiry, minStock, prices, codes...). Stock only moves through the ledger routes.
app.patch('/api/products/:id', authenticateToken, requireRole(...ROLES.INVENTORY_WRITE), async (req, res) => {
  try {
    if (req.body.stock !== undefined || req.body.currentStock !== undefined) {
      return res.status(400).json({ error: 'Stock cannot be edited directly. Use add-stock or adjust-stock so the change is logged.' });
    }
    const { before, after } = await ProductModel.update(req.params.id, req.body);
    if (!after) return res.status(404).json({ error: 'Product not found' });
    res.json(after);

    // Fire-and-forget expiry-crossing alert after responding.
    if (req.body.expiryDate !== undefined) {
      const crossed = expiryAlerts.detectExpiryCrossing(before.expiryDate, after.expiryDate);
      if (crossed) {
        expiryAlerts.notifyExpiryCrossing(after);
      }
    }
  } catch (error) {
    sendProductError(res, error, 'update product');
  }
});

// 3. Add Stock (logged as MANUAL_ADD)
app.patch('/api/products/:id/add-stock', authenticateToken, requireRole(...ROLES.INVENTORY_WRITE), async (req, res) => {
  try {
    const { quantity, supplierId } = req.body;
    const updatedProduct = await ProductModel.addStock(req.params.id, quantity, supplierId, req.user.id);
    res.json(updatedProduct);
  } catch (error) {
    sendProductError(res, error, 'update stock');
  }
});

// 3b. Manual stock correction with a required reason (logged as ADJUSTMENT)
app.post('/api/products/:id/adjust-stock', authenticateToken, requireRole(...ROLES.INVENTORY_WRITE), async (req, res) => {
  try {
    const { quantityChange, countedQuantity, reason, notes } = req.body;
    const updatedProduct = await ProductModel.adjustStock(req.params.id, { quantityChange, countedQuantity, reason, notes }, req.user.id);
    res.json(updatedProduct);
  } catch (error) {
    sendProductError(res, error, 'adjust stock');
  }
});

// 3c. Allowed adjustment reasons, so the UI never hard-codes the list
app.get('/api/stock-adjustment-reasons', authenticateToken, requireRole(...ROLES.INVENTORY_WRITE), (req, res) => {
  res.json(ADJUSTMENT_REASONS);
});

// 3d. Stock movement ledger (newest first). Filters: productId, type, from, to (dates), limit, before (last id loaded).
app.get('/api/stock-movements', authenticateToken, requireRole(...ROLES.INVENTORY_READ), async (req, res) => {
  try {
    if (req.query.type && !STOCK_MOVEMENT_TYPES.includes(req.query.type)) {
      return res.status(400).json({ error: `type must be one of: ${STOCK_MOVEMENT_TYPES.join(', ')}` });
    }
    res.json(await StockMovementModel.findAll(req.query));
  } catch (error) {
    console.error('Error fetching stock movements:', error);
    res.status(500).json({ error: 'Failed to fetch stock movements' });
  }
});

// 3e. One product's movement history
app.get('/api/products/:id/movements', authenticateToken, requireRole(...ROLES.INVENTORY_READ), async (req, res) => {
  try {
    const productId = parseInt(req.params.id, 10);
    if (!productId) return res.status(400).json({ error: 'Invalid product id' });
    res.json(await StockMovementModel.findAll({ ...req.query, productId }));
  } catch (error) {
    console.error('Error fetching product movements:', error);
    res.status(500).json({ error: 'Failed to fetch product movements' });
  }
});

// 4. Search Product by Barcode or 6-digit Code
app.get('/api/products/barcode/:code', authenticateToken, requireRole(...ROLES.PRODUCT_LOOKUP), async (req, res) => {
  try {
    const products = await ProductModel.findByBarcode(req.params.code);
    if (!products || products.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(products);
  } catch (error) {
    console.error('Error finding barcode:', error);
    res.status(500).json({ error: 'Barcode lookup failed' });
  }
});

// 5. Get All Suppliers (For inventory dropdowns)
app.get('/api/suppliers', authenticateToken, requireRole(...ROLES.INVENTORY_READ), async (req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: 'asc' },
    });
    res.json(suppliers);
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    res.status(500).json({ error: 'Failed to fetch suppliers' });
  }
});

// Days from placing an order with this supplier to receiving it; drives every product's reorder point.
const MAX_LEAD_TIME_DAYS = 90;
app.patch('/api/suppliers/:id', authenticateToken, requireRole(...ROLES.INVENTORY_WRITE), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const leadTimeDays = Number(req.body.leadTimeDays);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid supplier id' });
    if (!Number.isInteger(leadTimeDays) || leadTimeDays < 1 || leadTimeDays > MAX_LEAD_TIME_DAYS) {
      return res.status(400).json({ error: `Lead time must be a whole number of days from 1 to ${MAX_LEAD_TIME_DAYS}` });
    }
    const existing = await prisma.supplier.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: 'Supplier not found' });
    const supplier = await prisma.supplier.update({ where: { id }, data: { leadTimeDays } });
    res.json(supplier);
  } catch (error) {
    console.error('Error updating supplier:', error);
    res.status(500).json({ error: 'Failed to update supplier' });
  }
});

// --- PURCHASE ORDER ROUTES ---

// Maps purchasing failures onto HTTP: typed errors carry their own status, a vanished session is 401,
// anything unexpected is a generic 500.
const sendPurchasingError = (res, error, action) => {
  console.error(`Error ${action}:`, error);
  if (error.message === STALE_SESSION_ERROR) return res.status(401).json({ error: error.message });
  if (error instanceof PurchasingError) return res.status(error.status).json({ error: error.message });
  return res.status(500).json({ error: `Failed to ${action}` });
};

// Create a Purchase Order (DRAFT or PENDING) for one supplier
app.post('/api/purchase-orders', authenticateToken, requireRole(...ROLES.INVENTORY_WRITE), async (req, res) => {
  try {
    const { supplierId, items, terms, remarks, discount, shipTo, shippingAddress, purpose, tagging, status } = req.body;
    const purchaseOrder = await PurchaseOrderModel.create({
      supplierId,
      items,
      terms,
      remarks,
      discount,
      shipTo,
      shippingAddress,
      purpose,
      tagging,
      status,
      preparedBy: req.user.username,
      createdById: req.user.id,
    });
    res.status(201).json(purchaseOrder);
  } catch (error) {
    sendPurchasingError(res, error, 'create purchase order');
  }
});

// Download the styled .xlsx for a saved Purchase Order
app.get('/api/purchase-orders/:id/export', authenticateToken, requireRole(...ROLES.INVENTORY_WRITE), async (req, res) => {
  try {
    const purchaseOrder = await PurchaseOrderModel.findById(req.params.id);
    if (!purchaseOrder) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }

    const workbook = await buildPurchaseOrderWorkbook(purchaseOrder);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${purchaseOrder.poNumber}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error exporting purchase order:', error);
    res.status(500).json({ error: 'Failed to export purchase order' });
  }
});

// Purchase Orders awaiting a Receiving Report
app.get('/api/purchase-orders/pending', authenticateToken, requireRole(...ROLES.INVENTORY_WRITE), async (req, res) => {
  try {
    const pendingOrders = await PurchaseOrderModel.findPending();
    res.json(pendingOrders);
  } catch (error) {
    console.error('Error fetching pending purchase orders:', error);
    res.status(500).json({ error: 'Failed to fetch pending purchase orders' });
  }
});

// All Purchase Orders, for the "Purchase Orders" browse window (optionally filtered by PO number)
app.get('/api/purchase-orders', authenticateToken, requireRole(...ROLES.INVENTORY_WRITE), async (req, res) => {
  try {
    const purchaseOrders = await PurchaseOrderModel.findAll(req.query.search);
    res.json(purchaseOrders);
  } catch (error) {
    console.error('Error fetching purchase orders:', error);
    res.status(500).json({ error: 'Failed to fetch purchase orders' });
  }
});

// A single Purchase Order, for the "Open" view/edit action
app.get('/api/purchase-orders/:id', authenticateToken, requireRole(...ROLES.INVENTORY_WRITE), async (req, res) => {
  try {
    const purchaseOrder = await PurchaseOrderModel.findById(req.params.id);
    if (!purchaseOrder) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    res.json(purchaseOrder);
  } catch (error) {
    console.error('Error fetching purchase order:', error);
    res.status(500).json({ error: 'Failed to fetch purchase order' });
  }
});

// Edit a DRAFT purchase order (header and items are replaced)
app.put('/api/purchase-orders/:id', authenticateToken, requireRole(...ROLES.INVENTORY_WRITE), async (req, res) => {
  try {
    const { supplierId, items, terms, remarks, discount, shipTo, shippingAddress, purpose, tagging } = req.body;
    const purchaseOrder = await PurchaseOrderModel.updateDraft(req.params.id, {
      supplierId,
      items,
      terms,
      remarks,
      discount,
      shipTo,
      shippingAddress,
      purpose,
      tagging,
    });
    res.json(purchaseOrder);
  } catch (error) {
    sendPurchasingError(res, error, 'update purchase order');
  }
});

// Submit a DRAFT so it becomes PENDING (receivable)
app.post('/api/purchase-orders/:id/submit', authenticateToken, requireRole(...ROLES.INVENTORY_WRITE), async (req, res) => {
  try {
    res.json(await PurchaseOrderModel.submit(req.params.id));
  } catch (error) {
    sendPurchasingError(res, error, 'submit purchase order');
  }
});

// Cancel a DRAFT or PENDING purchase order
app.post('/api/purchase-orders/:id/cancel', authenticateToken, requireRole(...ROLES.INVENTORY_WRITE), async (req, res) => {
  try {
    res.json(await PurchaseOrderModel.cancel(req.params.id));
  } catch (error) {
    sendPurchasingError(res, error, 'cancel purchase order');
  }
});

// Delete a DRAFT or CANCELLED purchase order
app.delete('/api/purchase-orders/:id', authenticateToken, requireRole(...ROLES.INVENTORY_WRITE), async (req, res) => {
  try {
    await PurchaseOrderModel.delete(req.params.id);
    res.status(204).end();
  } catch (error) {
    sendPurchasingError(res, error, 'delete purchase order');
  }
});

// --- RECEIVING REPORT ROUTES ---

// File a Receiving Report against a pending Purchase Order (tops up stock/cost, closes the PO)
app.post('/api/receiving-reports', authenticateToken, requireRole(...ROLES.INVENTORY_WRITE), async (req, res) => {
  try {
    const { purchaseOrderId, items, deliveryNote, invoiceNo, remarks } = req.body;
    const receivingReport = await ReceivingReportModel.create({
      purchaseOrderId,
      items,
      deliveryNote,
      invoiceNo,
      remarks,
      receivedById: req.user.id,
    });
    res.status(201).json(receivingReport);
  } catch (error) {
    sendPurchasingError(res, error, 'create receiving report');
  }
});

// Download the styled .xlsx for a saved Receiving Report
app.get('/api/receiving-reports/:id/export', authenticateToken, requireRole(...ROLES.INVENTORY_WRITE), async (req, res) => {
  try {
    const receivingReport = await ReceivingReportModel.findById(req.params.id);
    if (!receivingReport) {
      return res.status(404).json({ error: 'Receiving report not found' });
    }

    const workbook = await buildReceivingReportWorkbook(receivingReport);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${receivingReport.rrNumber}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error exporting receiving report:', error);
    res.status(500).json({ error: 'Failed to export receiving report' });
  }
});

// All Receiving Reports, for the "Create Purchase Return" picker
app.get('/api/receiving-reports', authenticateToken, requireRole(...ROLES.INVENTORY_WRITE), async (req, res) => {
  try {
    const receivingReports = await ReceivingReportModel.findAll();
    res.json(receivingReports);
  } catch (error) {
    console.error('Error fetching receiving reports:', error);
    res.status(500).json({ error: 'Failed to fetch receiving reports' });
  }
});

// A single Receiving Report, for the "View Receiving Report" action
app.get('/api/receiving-reports/:id', authenticateToken, requireRole(...ROLES.INVENTORY_WRITE), async (req, res) => {
  try {
    const receivingReport = await ReceivingReportModel.findById(req.params.id);
    if (!receivingReport) {
      return res.status(404).json({ error: 'Receiving report not found' });
    }
    res.json(receivingReport);
  } catch (error) {
    console.error('Error fetching receiving report:', error);
    res.status(500).json({ error: 'Failed to fetch receiving report' });
  }
});

// --- PURCHASE RETURN ROUTES ---

// File a Purchase Return against a Receiving Report (decrements product stock)
app.post('/api/purchase-returns', authenticateToken, requireRole(...ROLES.INVENTORY_WRITE), async (req, res) => {
  try {
    const { receivingReportId, items, reason, remarks } = req.body;
    const purchaseReturn = await PurchaseReturnModel.create({
      receivingReportId,
      items,
      reason,
      remarks,
      createdById: req.user.id,
    });
    res.status(201).json(purchaseReturn);
  } catch (error) {
    sendPurchasingError(res, error, 'create purchase return');
  }
});

// All Purchase Returns
app.get('/api/purchase-returns', authenticateToken, requireRole(...ROLES.INVENTORY_WRITE), async (req, res) => {
  try {
    res.json(await PurchaseReturnModel.findAll());
  } catch (error) {
    console.error('Error fetching purchase returns:', error);
    res.status(500).json({ error: 'Failed to fetch purchase returns' });
  }
});

// A single Purchase Return
app.get('/api/purchase-returns/:id', authenticateToken, requireRole(...ROLES.INVENTORY_WRITE), async (req, res) => {
  try {
    const purchaseReturn = await PurchaseReturnModel.findById(req.params.id);
    if (!purchaseReturn) {
      return res.status(404).json({ error: 'Purchase return not found' });
    }
    res.json(purchaseReturn);
  } catch (error) {
    console.error('Error fetching purchase return:', error);
    res.status(500).json({ error: 'Failed to fetch purchase return' });
  }
});

// Download the styled .xlsx for a saved Purchase Return
app.get('/api/purchase-returns/:id/export', authenticateToken, requireRole(...ROLES.INVENTORY_WRITE), async (req, res) => {
  try {
    const purchaseReturn = await PurchaseReturnModel.findById(req.params.id);
    if (!purchaseReturn) {
      return res.status(404).json({ error: 'Purchase return not found' });
    }

    const workbook = await buildPurchaseReturnWorkbook(purchaseReturn);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${purchaseReturn.returnNo}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error exporting purchase return:', error);
    res.status(500).json({ error: 'Failed to export purchase return' });
  }
});

// --- POS SUPERVISOR APPROVAL ---

// Exchanges a supervisor's PIN for a short-lived approval token. The token is bound to the
// requesting cashier and action, and is presented back on checkout / X-Reading.
app.post('/api/pos/approve', authenticateToken, requireRole(...ROLES.POS), async (req, res) => {
  try {
    const { pin, action, discountPercent } = req.body;
    const result = await posApproval.requestApproval({ requester: req.user, pin, action, discountPercent });
    res.json(result);
  } catch (error) {
    if (error instanceof posApproval.ApprovalError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    console.error('Approval error:', error);
    res.status(500).json({ error: 'Failed to verify supervisor PIN' });
  }
});

// --- TRANSACTIONS ROUTES ---

// Create New Transaction (Checkout)
app.post('/api/transactions', authenticateToken, requireRole(...ROLES.POS), async (req, res) => {
  try {
    const io = req.app.get('io');
    const result = await TransactionModel.createCheckout({ ...req.body, cashierId: req.user.id }, io);

    // Broadcast updated financial metrics over WebSocket
    const updatedFinance = await FinanceModel.getSummary();
    io.to(FINANCE_ROOM).emit('finance_updated', updatedFinance);

    res.status(201).json(result);

    // Fire-and-forget silent receipt print. Never blocks or fails the sale.
    receiptPrinter
      .printReceipt({
        cashier: req.user.username,
        transactionId: result.transactionNo || result.id,
        items: result.items,
        subtotal: result.subtotal,
        discountAmount: result.discountAmount,
        totalAmount: result.totalAmount,
        paymentMethod: result.paymentMethod,
        amountPaid: req.body.amountPaid ?? result.totalAmount,
      })
      .catch((err) => console.error('[receipt-printer] Unexpected print error:', err.message));

    // Fire-and-forget low-stock crossing alert. Never blocks or fails the sale.
    const stockUpdates = result && result._stockUpdates;
    if (Array.isArray(stockUpdates) && stockUpdates.length > 0) {
      const crossings = lowStockAlerts.detectCrossings(stockUpdates);
      if (crossings.length > 0) {
        lowStockAlerts.notifyCrossings(crossings);
      }
    }
  } catch (error) {
    if (error instanceof TransactionModel.CheckoutError || error instanceof posApproval.ApprovalError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    console.error('Transaction error:', error);
    if (error.message === STALE_SESSION_ERROR) {
      return res.status(401).json({ error: error.message });
    }
    res.status(500).json({ error: 'Transaction failed' });
  }
});

// Silent on-demand print (used by the POS "Print" preview button, and for
// reprints) — same printer path as the automatic post-checkout print above.
app.post('/api/print/receipt', authenticateToken, requireRole(...ROLES.POS), async (req, res) => {
  try {
    const result = await receiptPrinter.printReceipt({ ...req.body, cashier: req.user.username });
    res.json(result);
  } catch (error) {
    console.error('Manual receipt print failed:', error);
    res.status(500).json({ printed: false, reason: 'error', error: error.message });
  }
});

// Get All Transactions
app.get('/api/transactions', authenticateToken, requireRole(...ROLES.FINANCE), async (req, res) => {
  try {
    const transactions = await TransactionModel.findAll();
    res.json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// --- DASHBOARD ROUTE ---
app.get('/api/dashboard/summary', authenticateToken, requireRole(...ROLES.DASHBOARD), async (req, res) => {
  try {
    const [todayRevenue, lowStockCount, dailySalesTrend, expiryWatchList, recentTransactions] = await Promise.all([
      DashboardModel.getTodayRevenue(),
      DashboardModel.getLowStockCount(10), // Threshold = 10 items
      DashboardModel.getDailySalesTrend(),
      DashboardModel.getExpiryWatchList(30),
      TransactionModel.findAll({ limit: 5 }),
    ]);

    res.json({
      todayRevenue,
      lowStockCount,
      dailySalesTrend,
      expiryWatchList,
      recentTransactions,
    });
  } catch (error) {
    console.error('Error fetching dashboard summary:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard metrics' });
  }
});

// --- AI FORECASTING ROUTE ---
app.get('/api/forecast', authenticateToken, requireRole(...ROLES.DASHBOARD), async (req, res) => {
  try {
    const { days = 30, asOf } = req.query;
    if (asOf !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(asOf))) {
      return res.status(400).json({ success: false, message: 'asOf must be a date like 2026-09-21.' });
    }
    const forecastData = await DemandForecastModel.getForecastData(days, { asOf });
    // Keep a copy of today's forecast so it can be graded later (no-op after the first request of the day).
    if (asOf === undefined) forecastSnapshots.saveFromRequest(forecastData);

    res.json({
      success: true,
      data: forecastData,
    });
  } catch (error) {
    console.error('Error fetching AI forecast:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate AI demand forecast',
      error: error.message,
    });
  }
});

// --- FINANCE CONTROL ROUTE ---
app.get('/api/finance/summary', authenticateToken, requireRole(...ROLES.FINANCE), async (req, res) => {
  try {
    const data = await FinanceModel.getSummary();
    res.json(data);
  } catch (error) {
    console.error('Error fetching finance summary:', error);
    res.status(500).json({ error: 'Failed to fetch financial audit summary' });
  }
});

// --- RECONCILIATION ROUTES ---

// X-Reading needs a supervisor approval token (POST /api/pos/approve with action XREAD),
// sent in the X-Approval-Token header.
const sendApprovalOrReconError = (res, error) => {
  if (error instanceof posApproval.ApprovalError || error instanceof ReconciliationModel.ReconciliationError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return true;
  }
  return false;
};

// Get today's X-Reading figures for the signed-in cashier
app.get('/api/reconciliation/expected-cash', authenticateToken, requireRole(...ROLES.RECONCILIATION_WRITE), async (req, res) => {
  try {
    await posApproval.verifyApproval(req.headers['x-approval-token'], { action: 'XREAD', cashierId: req.user.id });
    const data = await ReconciliationModel.getExpectedCash(req.user.id);
    return res.status(200).json(data);
  } catch (error) {
    if (sendApprovalOrReconError(res, error)) return;
    console.error('Error calculating expected cash:', error);
    return res.status(500).json({
      error: 'Failed to calculate expected cash',
      expectedCash: 0,
      grossSales: 0,
    });
  }
});

// Save End of Day Reconciliation (one per cashier per day; all totals computed server-side)
app.post('/api/reconciliation', authenticateToken, requireRole(...ROLES.RECONCILIATION_WRITE), async (req, res) => {
  try {
    const approval = await posApproval.verifyApproval(req.headers['x-approval-token'], {
      action: 'XREAD',
      cashierId: req.user.id,
    });
    const record = await ReconciliationModel.create({
      denominations: req.body.denominations,
      notes: req.body.notes,
      cashierId: req.user.id,
    });
    posApproval.consumeApproval(approval);

    // Broadcast updated financial metrics over WebSocket
    const io = req.app.get('io');
    const updatedFinance = await FinanceModel.getSummary();
    io.to(FINANCE_ROOM).emit('finance_updated', updatedFinance);

    res.status(201).json({ message: 'Reconciliation Submitted', record });
  } catch (error) {
    if (sendApprovalOrReconError(res, error)) return;
    console.error('Error creating reconciliation:', error);
    if (error.message === STALE_SESSION_ERROR) {
      return res.status(401).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to submit reconciliation' });
  }
});

// Get All Historical Reconciliations
app.get('/api/reconciliation', authenticateToken, requireRole(...ROLES.RECONCILIATION_READ), async (req, res) => {
  try {
    const recons = await ReconciliationModel.findAll();
    res.json(recons);
  } catch (error) {
    console.error('Error fetching reconciliations:', error);
    res.status(500).json({ error: 'Failed to fetch all reconciliations' });
  }
});

// --- ALERT ROUTES (low-stock and expiry emails) ---

app.get('/api/alerts/low-stock', authenticateToken, requireRole(...ROLES.DASHBOARD), async (req, res) => {
  try {
    const products = await lowStockAlerts.findCurrentlyLow();
    res.json({ count: products.length, products });
  } catch (error) {
    console.error('Low-stock query failed:', error);
    res.status(500).json({ error: 'Failed to query low-stock products' });
  }
});

app.post('/api/alerts/low-stock/send-now', authenticateToken, requireRole(...ROLES.DASHBOARD), async (req, res) => {
  if (!mailer.isConfigured()) {
    return res.status(503).json({
      error: 'SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, ALERT_RECIPIENTS in backend/.env.',
    });
  }
  try {
    const result = await lowStockAlerts.sendDigestNow();
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('Manual low-stock digest failed:', error);
    res.status(500).json({ error: 'Failed to send low-stock digest email' });
  }
});

app.get('/api/alerts/expiry', authenticateToken, requireRole(...ROLES.DASHBOARD), async (req, res) => {
  try {
    const products = await expiryAlerts.findExpiringSoon();
    res.json({
      windowDays: expiryAlerts.getWindowDays(),
      count: products.length,
      products,
    });
  } catch (error) {
    console.error('Expiry query failed:', error);
    res.status(500).json({ error: 'Failed to query expiring products' });
  }
});

app.post('/api/alerts/expiry/send-now', authenticateToken, requireRole(...ROLES.DASHBOARD), async (req, res) => {
  if (!mailer.isConfigured()) {
    return res.status(503).json({
      error: 'SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, ALERT_RECIPIENTS in backend/.env.',
    });
  }
  try {
    const result = await expiryAlerts.sendDigestNow();
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('Manual expiry digest failed:', error);
    res.status(500).json({ error: 'Failed to send expiry digest email' });
  }
});

// Forecast accuracy: saved forecasts graded against real sales (live) plus the AI service's backtest.
app.get('/api/forecast/accuracy', authenticateToken, requireRole(...ROLES.DASHBOARD), async (req, res) => {
  try {
    res.json({ success: true, data: await ForecastAccuracyModel.getAccuracy() });
  } catch (error) {
    console.error('Error computing forecast accuracy:', error);
    res.status(500).json({ success: false, message: 'Failed to compute forecast accuracy' });
  }
});

// --- FORECAST DIGEST ROUTES ---

app.post('/api/alerts/forecast/send-now', authenticateToken, requireRole(...ROLES.DASHBOARD), async (req, res) => {
  if (!mailer.isConfigured()) {
    return res.status(503).json({
      error: 'SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, ALERT_RECIPIENTS in backend/.env.',
    });
  }
  try {
    const days = Number(req.query.days) || 30;
    const result = await forecastAlerts.sendDigestNow(days);
    res.json(result);
  } catch (error) {
    console.error('Manual forecast digest failed:', error);
    res.status(500).json({ error: 'Failed to send forecast digest email' });
  }
});

app.get('/api/alerts/forecast', authenticateToken, requireRole(...ROLES.DASHBOARD), async (req, res) => {
  try {
    const days = Number(req.query.days) || 30;
    const digest = await forecastAlerts.buildDigest(days);
    if (!digest) return res.status(503).json({ error: 'Forecast unavailable' });
    res.json(digest);
  } catch (error) {
    console.error('Forecast query failed:', error);
    res.status(500).json({ error: 'Failed to build forecast digest' });
  }
});

// --- DAILY DIGEST (scheduled) ---

function startDailyDigestCron() {
  const expr = process.env.DAILY_DIGEST_CRON || '0 8 * * *';
  if (!cron.validate(expr)) {
    console.error(`[digest] invalid DAILY_DIGEST_CRON="${expr}" — digest not scheduled.`);
    return;
  }
  cron.schedule(
    expr,
    async () => {
      if (!mailer.isConfigured()) return;
      try {
        await lowStockAlerts.sendDigestNow();
      } catch (err) {
        console.error('[low-stock] scheduled digest failed:', err.message);
      }
      try {
        await expiryAlerts.sendDigestNow();
      } catch (err) {
        console.error('[expiry] scheduled digest failed:', err.message);
      }
      try {
        await forecastAlerts.sendDigestNow();
      } catch (err) {
        console.error('[forecast] scheduled digest failed:', err.message);
      }
    },
    { timezone: process.env.TZ || 'Asia/Manila' },
  );
  console.log(
    `[digest] low-stock + expiry + forecast scheduled with cron "${expr}" (tz=${process.env.TZ || 'Asia/Manila'})`,
  );
}

// Saves the forecast for the day that just began (from the complete previous day) so it can be graded
// later. Independent of SMTP; a missed run is caught up by the first forecast request of the day.
function startForecastSnapshotCron() {
  const expr = process.env.FORECAST_SNAPSHOT_CRON || '5 0 * * *';
  if (!cron.validate(expr)) {
    console.error(`[forecast] invalid FORECAST_SNAPSHOT_CRON="${expr}" — nightly snapshot not scheduled.`);
    return;
  }
  cron.schedule(
    expr,
    async () => {
      try {
        const result = await forecastSnapshots.saveToday();
        console.log('[forecast] nightly snapshot:', result.saved ? `saved ${result.items} products` : result.reason);
      } catch (err) {
        console.error('[forecast] nightly snapshot failed:', err.message);
      }
    },
    { timezone: DemandForecastModel.STORE_TIMEZONE },
  );
  console.log(`[forecast] nightly snapshot scheduled with cron "${expr}" (tz=${DemandForecastModel.STORE_TIMEZONE})`);
}

server.listen(PORT, async () => {
  console.log(`🚀 POS Server running on http://localhost:${PORT}`);
  startForecastSnapshotCron();
  const smtpOk = await mailer.verifyMailer();
  if (smtpOk) {
    startDailyDigestCron();
  } else if (mailer.isConfigured()) {
    console.log('[digest] SMTP credentials rejected — fix SMTP_PASS in backend/.env and restart. Alerts OFF.');
  } else {
    console.log('[digest] SMTP not configured — per-event alerts and daily digest disabled.');
  }
});