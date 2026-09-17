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
const { ProductModel, prisma } = require('./models/Product');
const TransactionModel = require('./models/Transaction');
const ReconciliationModel = require('./models/Reconciliation');
const DashboardModel = require('./models/Dashboard');
const DemandForecastModel = require('./models/DemandForecast');
const FinanceModel = require('./models/FinanceModel');
const { PurchaseOrderModel } = require('./models/PurchaseOrder');
const { buildPurchaseOrderWorkbook } = require('./services/purchaseOrderExcel');
const { ReceivingReportModel } = require('./models/ReceivingReport');
const { buildReceivingReportWorkbook } = require('./services/receivingReportExcel');
const { PurchaseReturnModel } = require('./models/PurchaseReturn');
const { buildPurchaseReturnWorkbook } = require('./services/purchaseReturnExcel');

// Import Services
const mailer = require('./services/mailer');
const lowStockAlerts = require('./services/lowStockAlerts');
const expiryAlerts = require('./services/expiryAlerts');
const forecastAlerts = require('./services/forecastAlerts');

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

io.on('connection', (socket) => {
  console.log('Client connected to WebSocket:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// --- ROUTES ---

// 1. Get All Products (Includes supplier relations and computed status)
app.get('/api/products', async (req, res) => {
  try {
    const products = await ProductModel.findAll();
    res.json(products);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// 2. Create New Product
app.post('/api/products', async (req, res) => {
  try {
    const product = await ProductModel.create(req.body);
    res.status(201).json(product);
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// 2b. Update a product (currently used to set expiry, minStock, etc.)
app.patch('/api/products/:id', async (req, res) => {
  try {
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
    console.error('Product update error:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// 3. Update Product Stock (Add Stock)
app.patch('/api/products/:id/add-stock', async (req, res) => {
  try {
    const { quantity, supplierId } = req.body;
    if (!quantity || isNaN(quantity)) {
      return res.status(400).json({ error: 'Valid stock quantity is required' });
    }
    const updatedProduct = await ProductModel.addStock(req.params.id, quantity, supplierId);
    res.json(updatedProduct);
  } catch (error) {
    console.error('Error updating stock:', error);
    res.status(500).json({ error: 'Failed to update stock' });
  }
});

// 4. Search Product by Barcode or 6-digit Code
app.get('/api/products/barcode/:code', async (req, res) => {
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
app.get('/api/suppliers', async (req, res) => {
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

// --- PURCHASE ORDER ROUTES ---

// Create a Purchase Order for one supplier from checked low-stock items
app.post('/api/purchase-orders', async (req, res) => {
  try {
    const { supplierId, items, terms, remarks, preparedBy, createdById } = req.body;
    const purchaseOrder = await PurchaseOrderModel.create({
      supplierId,
      items,
      terms,
      remarks,
      preparedBy,
      createdById,
    });
    res.status(201).json(purchaseOrder);
  } catch (error) {
    console.error('Error creating purchase order:', error);
    res.status(400).json({ error: error.message || 'Failed to create purchase order' });
  }
});

// Download the styled .xlsx for a saved Purchase Order
app.get('/api/purchase-orders/:id/export', async (req, res) => {
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
app.get('/api/purchase-orders/pending', async (req, res) => {
  try {
    const pendingOrders = await PurchaseOrderModel.findPending();
    res.json(pendingOrders);
  } catch (error) {
    console.error('Error fetching pending purchase orders:', error);
    res.status(500).json({ error: 'Failed to fetch pending purchase orders' });
  }
});

// --- RECEIVING REPORT ROUTES ---

// File a Receiving Report against a pending Purchase Order (tops up stock/cost, closes the PO)
app.post('/api/receiving-reports', async (req, res) => {
  try {
    const { purchaseOrderId, items, deliveryNote, invoiceNo, remarks, receivedById } = req.body;
    const receivingReport = await ReceivingReportModel.create({
      purchaseOrderId,
      items,
      deliveryNote,
      invoiceNo,
      remarks,
      receivedById,
    });
    res.status(201).json(receivingReport);
  } catch (error) {
    console.error('Error creating receiving report:', error);
    res.status(400).json({ error: error.message || 'Failed to create receiving report' });
  }
});

// Download the styled .xlsx for a saved Receiving Report
app.get('/api/receiving-reports/:id/export', async (req, res) => {
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
app.get('/api/receiving-reports', async (req, res) => {
  try {
    const receivingReports = await ReceivingReportModel.findAll();
    res.json(receivingReports);
  } catch (error) {
    console.error('Error fetching receiving reports:', error);
    res.status(500).json({ error: 'Failed to fetch receiving reports' });
  }
});

// --- PURCHASE RETURN ROUTES ---

// File a Purchase Return against a Receiving Report (decrements product stock)
app.post('/api/purchase-returns', async (req, res) => {
  try {
    const { receivingReportId, items, reason, remarks, createdById } = req.body;
    const purchaseReturn = await PurchaseReturnModel.create({
      receivingReportId,
      items,
      reason,
      remarks,
      createdById,
    });
    res.status(201).json(purchaseReturn);
  } catch (error) {
    console.error('Error creating purchase return:', error);
    res.status(400).json({ error: error.message || 'Failed to create purchase return' });
  }
});

// Download the styled .xlsx for a saved Purchase Return
app.get('/api/purchase-returns/:id/export', async (req, res) => {
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

// --- TRANSACTIONS ROUTES ---

// Create New Transaction (Checkout)
app.post('/api/transactions', async (req, res) => {
  try {
    const io = req.app.get('io');
    const result = await TransactionModel.createCheckout(req.body, io);

    // Broadcast updated financial metrics over WebSocket
    const updatedFinance = await FinanceModel.getSummary();
    io.emit('finance_updated', updatedFinance);

    res.status(201).json(result);

    // Fire-and-forget low-stock crossing alert. Never blocks or fails the sale.
    const stockUpdates = result && result._stockUpdates;
    if (Array.isArray(stockUpdates) && stockUpdates.length > 0) {
      const crossings = lowStockAlerts.detectCrossings(stockUpdates);
      if (crossings.length > 0) {
        lowStockAlerts.notifyCrossings(crossings);
      }
    }
  } catch (error) {
    console.error('Transaction error:', error);
    res.status(500).json({ error: 'Transaction failed' });
  }
});

// Get All Transactions
app.get('/api/transactions', async (req, res) => {
  try {
    const transactions = await TransactionModel.findAll();
    res.json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// --- DASHBOARD ROUTE ---
app.get('/api/dashboard/summary', async (req, res) => {
  try {
    const [todayRevenue, lowStockCount, dailySalesTrend, expiryWatchList] = await Promise.all([
      DashboardModel.getTodayRevenue(),
      DashboardModel.getLowStockCount(10), // Threshold = 10 items
      DashboardModel.getDailySalesTrend(),
      DashboardModel.getExpiryWatchList(30),
    ]);

    res.json({
      todayRevenue,
      lowStockCount,
      dailySalesTrend,
      expiryWatchList,
    });
  } catch (error) {
    console.error('Error fetching dashboard summary:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard metrics' });
  }
});

// --- AI FORECASTING ROUTE ---
app.get('/api/forecast', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const forecastData = await DemandForecastModel.getForecastData(days);

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
app.get('/api/finance/summary', async (req, res) => {
  try {
    const data = await FinanceModel.getSummary();
    res.json(data);
  } catch (error) {
    console.error('Error fetching finance summary:', error);
    res.status(500).json({ error: 'Failed to fetch financial audit summary' });
  }
});

// --- RECONCILIATION ROUTES ---

// Get Expected Cash for Today
app.get('/api/reconciliation/expected-cash', async (req, res) => {
  try {
    const data = await ReconciliationModel.getExpectedCash();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Error calculating expected cash:', error);
    return res.status(500).json({
      error: 'Failed to calculate expected cash',
      expectedCash: 0,
      grossSales: 0,
    });
  }
});

// Save End of Day Reconciliation
app.post('/api/reconciliation', async (req, res) => {
  try {
    const record = await ReconciliationModel.create(req.body);

    // Broadcast updated financial metrics over WebSocket
    const io = req.app.get('io');
    const updatedFinance = await FinanceModel.getSummary();
    io.emit('finance_updated', updatedFinance);

    res.status(201).json({ message: 'Reconciliation Submitted', record });
  } catch (error) {
    console.error('Error creating reconciliation:', error);
    res.status(500).json({ error: 'Failed to submit reconciliation' });
  }
});

// Get All Historical Reconciliations
app.get('/api/reconciliation', async (req, res) => {
  try {
    const recons = await ReconciliationModel.findAll();
    res.json(recons);
  } catch (error) {
    console.error('Error fetching reconciliations:', error);
    res.status(500).json({ error: 'Failed to fetch all reconciliations' });
  }
});

// --- ALERT ROUTES (low-stock and expiry emails) ---

app.get('/api/alerts/low-stock', async (req, res) => {
  try {
    const products = await lowStockAlerts.findCurrentlyLow();
    res.json({ count: products.length, products });
  } catch (error) {
    console.error('Low-stock query failed:', error);
    res.status(500).json({ error: 'Failed to query low-stock products' });
  }
});

app.post('/api/alerts/low-stock/send-now', async (req, res) => {
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

app.get('/api/alerts/expiry', async (req, res) => {
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

app.post('/api/alerts/expiry/send-now', async (req, res) => {
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

// --- FORECAST DIGEST ROUTES ---

app.post('/api/alerts/forecast/send-now', async (req, res) => {
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

app.get('/api/alerts/forecast', async (req, res) => {
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

server.listen(PORT, async () => {
  console.log(`🚀 POS Server running on http://localhost:${PORT}`);
  const smtpOk = await mailer.verifyMailer();
  if (smtpOk) {
    startDailyDigestCron();
  } else if (mailer.isConfigured()) {
    console.log('[digest] SMTP credentials rejected — fix SMTP_PASS in backend/.env and restart. Alerts OFF.');
  } else {
    console.log('[digest] SMTP not configured — per-event alerts and daily digest disabled.');
  }
});