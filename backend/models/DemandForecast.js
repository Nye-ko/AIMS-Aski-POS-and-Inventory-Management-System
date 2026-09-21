const { prisma } = require('./Product');
const axios = require('axios');
const { buildForecast } = require('../services/forecastEngine');
const { loadDailySales } = require('./salesHistory');
const { loadStockoutDays } = require('./stockHistory');

const PYTHON_AI_URL = process.env.PYTHON_AI_URL || 'http://localhost:8000/api/v1/forecast';
const AI_TIMEOUT_MS = Number(process.env.PYTHON_AI_TIMEOUT_MS) || 15000;
const HISTORY_DAYS = Number(process.env.FORECAST_HISTORY_DAYS) || 180;
// Stock-out days are only needed for recent demand (a 28-day window, plus the backtest's replays), so
// only this many days back are sent; a product stuck at zero stock would otherwise add a row per day.
const STOCKOUT_LOOKBACK_DAYS = 90;
const MIN_HORIZON_DAYS = 1;
const MAX_HORIZON_DAYS = 365;
const MS_PER_DAY = 86400000;

// Sales are bucketed into calendar days in the store's own time zone, not UTC, so a 7am sale in
// Manila counts toward that day's total instead of the previous one.
const resolveTimeZone = () => {
  const wanted = process.env.STORE_TIMEZONE || process.env.TZ || 'Asia/Manila';
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: wanted });
    return wanted;
  } catch {
    return 'Asia/Manila';
  }
};
const STORE_TIMEZONE = resolveTimeZone();

const localDate = (instant, timeZone) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);

const clampHorizon = (value) => {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return 30;
  return Math.min(MAX_HORIZON_DAYS, Math.max(MIN_HORIZON_DAYS, n));
};

// Everything the forecast needs, aggregated in SQL: one row per product per day, and one row per day.
const loadForecastInput = async (daysToForecast, asOf) => {
  const timeZone = STORE_TIMEZONE;
  // Coarse UTC lower bound (a couple of days of slack); the engine applies the exact window.
  const lowerBound = new Date(Date.parse(`${asOf}T00:00:00Z`) - (HISTORY_DAYS + 2) * MS_PER_DAY);

  const stockoutFrom = new Date(Date.parse(`${asOf}T00:00:00Z`) - (STOCKOUT_LOOKBACK_DAYS + 2) * MS_PER_DAY);
  const [products, { salesRows, totalRows }, stockoutsByProduct] = await Promise.all([
    prisma.product.findMany({
      select: { id: true, sku: true, name: true, category: true, stock: true, minStock: true, expiryDate: true, createdAt: true },
      orderBy: { id: 'asc' },
    }),
    loadDailySales({ since: lowerBound, timeZone }),
    loadStockoutDays({
      since: stockoutFrom,
      timeZone,
      fromDay: localDate(stockoutFrom, timeZone),
      lastDay: new Date(Date.parse(`${asOf}T00:00:00Z`) - MS_PER_DAY).toISOString().slice(0, 10),
    }),
  ]);

  const skuById = new Map();
  const productInputs = products.map((p) => {
    const sku = p.sku || `PROD-${p.id}`;
    skuById.set(p.id, sku);
    return {
      id: p.id,
      sku,
      name: p.name,
      category: p.category,
      stock: p.stock,
      minStock: p.minStock,
      // Expiry is a calendar date (stored as UTC midnight); creation is a real instant in store time.
      expiryDate: p.expiryDate ? p.expiryDate.toISOString().slice(0, 10) : null,
      createdAt: localDate(p.createdAt, timeZone),
    };
  });

  return {
    asOf,
    timezone: timeZone,
    daysToForecast,
    historyDays: HISTORY_DAYS,
    products: productInputs,
    sales: salesRows
      .filter((r) => skuById.has(r.productId))
      .map((r) => ({ sku: skuById.get(r.productId), date: r.date, quantity: r.quantity, revenue: r.revenue })),
    dailyTotals: totalRows.map((r) => ({ date: r.date, gross: r.gross, discount: r.discount, net: r.net })),
    stockouts: [...stockoutsByProduct]
      .filter(([productId]) => skuById.has(productId))
      .flatMap(([productId, dates]) => dates.map((date) => ({ sku: skuById.get(productId), date }))),
  };
};

const looksLikeForecast = (data) =>
  data &&
  typeof data === 'object' &&
  data.kpis &&
  Array.isArray(data.revenueTrajectory) &&
  Array.isArray(data.skuDemandList) &&
  data.meta;

// `asOf` (YYYY-MM-DD, store-local "today") is injectable so a given day's forecast can be reproduced.
const getForecastData = async (days = 30, { asOf } = {}) => {
  const daysToForecast = clampHorizon(days);
  const today = asOf || localDate(new Date(), STORE_TIMEZONE);
  const input = await loadForecastInput(daysToForecast, today);

  try {
    const response = await axios.post(PYTHON_AI_URL, input, { timeout: AI_TIMEOUT_MS });
    if (!looksLikeForecast(response.data)) throw new Error('AI service returned an unexpected response shape');
    return response.data;
  } catch (error) {
    const detail = error.response ? `HTTP ${error.response.status} ${JSON.stringify(error.response.data).slice(0, 300)}` : error.message;
    console.warn(`[forecast] AI service unavailable (${detail}). Using the built-in engine (same method, source: "fallback").`);
    const result = buildForecast(input, { source: 'fallback' });
    result.meta.generatedAt = new Date().toISOString();
    return result;
  }
};

module.exports = { getForecastData, loadForecastInput, STORE_TIMEZONE, HISTORY_DAYS, PYTHON_AI_URL, localDate };
