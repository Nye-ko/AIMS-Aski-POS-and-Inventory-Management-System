BigInt.prototype.toJSON = function () {
  return Number(this);
};

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Import Models
const { ProductModel, prisma } = require('./models/Product');
const TransactionModel = require('./models/Transaction');
const ReconciliationModel = require('./models/Reconciliation');
const DashboardModel = require('./models/Dashboard');
const DemandForecastModel = require('./models/DemandForecast');
const FinanceModel = require('./models/FinanceModel');

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

// 3. Update Product Stock (Add Stock)
app.patch('/api/products/:id/stock', async (req, res) => {
  try {
    const { quantity } = req.body;
    if (!quantity || isNaN(quantity)) {
      return res.status(400).json({ error: 'Valid stock quantity is required' });
    }
    const updatedProduct = await ProductModel.addStock(req.params.id, quantity);
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

server.listen(PORT, () => {
  console.log(`🚀 POS Server running on http://localhost:${PORT}`);
});