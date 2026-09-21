// Deterministic demand & revenue forecast engine — the JavaScript twin of ai-service/forecast_engine.py.
//
// Used as the fallback when the Python service is unreachable, so the dashboard and the daily email show
// the same numbers either way instead of made-up ones. The two implementations are held identical by a
// shared golden fixture (ai-service/tests/fixtures, checked by backend/test/forecastEngine.test.js):
// change one, change the other, regenerate the fixture with `python tests/make_fixture.py`.
//
// Money is summed in integer cents so results do not depend on row order. Dates are ISO "YYYY-MM-DD"
// strings in the store's local time zone.

const ENGINE_NAME = 'rate-mean';
const ENGINE_VERSION = '1.0.0';

const RATE_WINDOW_DAYS = 28;
const TRAJECTORY_HISTORY_DAYS = 30;
const EXPIRY_HORIZON_DAYS = 180;
const MIN_DAYS_FOR_GROWTH = 14;
const EPS = 1e-9;

const STATUS_REORDER = 'REORDER NOW';
const STATUS_EXPIRY = 'EXPIRY RISK';
const STATUS_OK = 'HEALTHY';
const STATUS_ORDER = { [STATUS_REORDER]: 0, [STATUS_EXPIRY]: 1, [STATUS_OK]: 2 };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MS_PER_DAY = 86400000;

// Round half up, matching the Python engine.
const round = (x, digits) => {
  const f = 10 ** digits;
  return Math.floor(x * f + 0.5) / f + 0;
};
const cents = (x) => Math.floor(Number(x) * 100 + 0.5);

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const day = (iso) => {
  if (!ISO.test(iso)) throw new Error(`Invalid date "${iso}" (expected YYYY-MM-DD).`);
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
};
const toIso = (n) => new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
const label = (n) => {
  const d = new Date(n * MS_PER_DAY);
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')}`;
};

const confidence = (dataDays) => {
  if (dataDays <= 0) return 'none';
  if (dataDays < MIN_DAYS_FOR_GROWTH) return 'low';
  if (dataDays < RATE_WINDOW_DAYS) return 'medium';
  return 'high';
};

const sum = (arr) => arr.reduce((a, b) => a + b, 0);

function buildForecast(payload, { source = 'fallback' } = {}) {
  const asOf = day(payload.asOf);
  const horizon = Number(payload.daysToForecast);
  const historyDays = Number(payload.historyDays ?? 180);
  const windowEnd = asOf - 1; // last complete day; today is still being rung up
  const windowStart = asOf - historyDays;
  const warnings = [];

  const products = payload.products || [];
  const known = new Set(products.map((p) => p.sku));

  // --- sales per SKU per day (units, cents) inside the window ---------------------------------
  const skuDays = new Map(); // sku -> Map(day -> [units, cents])
  let ignored = 0;
  for (const s of payload.sales || []) {
    const d = day(s.date);
    if (d < windowStart || d > windowEnd) continue;
    if (!known.has(s.sku)) {
      ignored += 1;
      continue;
    }
    if (!skuDays.has(s.sku)) skuDays.set(s.sku, new Map());
    const byDay = skuDays.get(s.sku);
    if (!byDay.has(d)) byDay.set(d, [0, 0]);
    const cell = byDay.get(d);
    cell[0] += Math.trunc(Number(s.quantity));
    cell[1] += cents(s.revenue);
  }
  if (ignored) warnings.push(`${ignored} sales rows ignored (unknown product).`);

  // --- store-level daily gross / discount (cents) ---------------------------------------------
  const storeDays = new Map(); // day -> [gross, discount]
  const totals = payload.dailyTotals || [];
  if (totals.length) {
    for (const t of totals) {
      const d = day(t.date);
      if (d >= windowStart && d <= windowEnd) {
        if (!storeDays.has(d)) storeDays.set(d, [0, 0]);
        const cell = storeDays.get(d);
        cell[0] += cents(t.gross);
        cell[1] += cents(t.discount);
      }
    }
  } else {
    for (const byDay of skuDays.values()) {
      for (const [d, [, c]] of byDay) {
        if (!storeDays.has(d)) storeDays.set(d, [0, 0]);
        storeDays.get(d)[0] += c;
      }
    }
  }

  const allDays = [...storeDays.keys()];
  for (const byDay of skuDays.values()) allDays.push(...byDay.keys());
  const storeStart = allDays.length ? Math.min(...allDays) : null;
  const observedDays = storeStart === null ? 0 : windowEnd - storeStart + 1;

  if (storeStart === null) {
    warnings.push(`No sales history in the last ${historyDays} days; demand is shown as 0.`);
  } else if (observedDays < MIN_DAYS_FOR_GROWTH) {
    warnings.push(`Only ${observedDays} days of sales history; forecasts are low confidence.`);
  }

  const storeGross = (d) => (storeDays.get(d) || [0, 0])[0];

  // --- store revenue rate, discounts, growth --------------------------------------------------
  let rateGrossCents = 0;
  let discountRatio = 0;
  let growthPct = null;
  if (storeStart !== null) {
    const rateStart = Math.max(storeStart, windowEnd - RATE_WINDOW_DAYS + 1);
    const rateDays = windowEnd - rateStart + 1;
    let g = 0;
    for (let d = rateStart; d <= windowEnd; d += 1) g += storeGross(d);
    rateGrossCents = g / rateDays;

    const totalGross = sum([...storeDays.values()].map((v) => v[0]));
    const totalDiscount = sum([...storeDays.values()].map((v) => v[1]));
    discountRatio = totalGross > 0 ? totalDiscount / totalGross : 0;
    const histAvg = totalGross / observedDays;
    if (observedDays >= MIN_DAYS_FOR_GROWTH && histAvg > 0) {
      growthPct = round((rateGrossCents / histAvg - 1) * 100, 1);
    }
  }

  const projectedGross = round((rateGrossCents * horizon) / 100, 2);
  const projectedDiscounts = round(projectedGross * discountRatio, 2);
  const projectedNet = round(projectedGross - projectedDiscounts, 2);
  const grossGrowth = growthPct === null ? 'n/a' : `${growthPct >= 0 ? '+' : '-'}${Math.abs(growthPct).toFixed(1)}%`;

  // --- trajectory: recent actuals, then a flat daily forecast ---------------------------------
  const trajectory = [];
  if (storeStart !== null) {
    const first = Math.max(storeStart, windowEnd - TRAJECTORY_HISTORY_DAYS + 1);
    for (let d = first; d <= windowEnd; d += 1) {
      trajectory.push({ day: label(d), date: toIso(d), actual: round(storeGross(d) / 100, 2), forecast: null });
    }
    trajectory[trajectory.length - 1].forecast = trajectory[trajectory.length - 1].actual; // join the two lines
    const dailyForecast = round(rateGrossCents / 100, 2);
    for (let i = 0; i < horizon; i += 1) {
      const d = asOf + i;
      trajectory.push({ day: label(d), date: toIso(d), actual: null, forecast: dailyForecast });
    }
  }

  // --- per-SKU demand and status --------------------------------------------------------------
  const items = [];
  const categoryCents = new Map();
  for (const p of products) {
    const byDay = skuDays.get(p.sku) || new Map();
    const candidates = [];
    if (p.createdAt) candidates.push(day(p.createdAt));
    if (byDay.size) candidates.push(Math.min(...byDay.keys()));
    let skuStart = null;
    if (storeStart !== null) {
      skuStart = Math.max(candidates.length ? Math.min(...candidates) : storeStart, storeStart);
    }

    let dataDays = 0;
    let units = 0;
    let c = 0;
    if (skuStart !== null && skuStart <= windowEnd) {
      const rateStart = Math.max(skuStart, windowEnd - RATE_WINDOW_DAYS + 1);
      dataDays = windowEnd - rateStart + 1;
      for (let d = rateStart; d <= windowEnd; d += 1) {
        const cell = byDay.get(d);
        if (cell) {
          units += cell[0];
          c += cell[1];
        }
      }
    }
    const rate = dataDays > 0 ? units / dataDays : 0;

    const stock = Math.max(0, Math.trunc(Number(p.stock) || 0));
    const forecast7 = rate * 7;
    const daysToExpiry = p.expiryDate ? day(p.expiryDate) - asOf : null;

    let status;
    if (daysToExpiry !== null && daysToExpiry <= 0 && stock > 0) {
      status = STATUS_EXPIRY; // already expired stock
    } else if (forecast7 > 0 && stock <= forecast7) {
      status = STATUS_REORDER;
    } else if (
      daysToExpiry !== null &&
      stock > 0 &&
      daysToExpiry <= EXPIRY_HORIZON_DAYS &&
      stock > rate * daysToExpiry
    ) {
      status = STATUS_EXPIRY; // will not sell through before it expires
    } else {
      status = STATUS_OK;
    }

    const category = p.category || 'Uncategorized';
    categoryCents.set(category, (categoryCents.get(category) || 0) + c);

    items.push({
      id: p.id,
      sku: p.sku,
      name: p.name,
      category,
      stock,
      minStock: Math.trunc(Number(p.minStock) || 0),
      dailyDemand: round(rate, 2),
      forecast7Day: round(forecast7, 1),
      forecastHorizon: round(rate * horizon, 1),
      reorderQty: Math.ceil(Math.max(0, forecast7 - stock) - EPS) + 0, // + 0 turns -0 into 0
      daysOfCover: rate > 0 ? round(stock / rate, 1) : null,
      status,
      confidence: confidence(dataDays),
      dataDays,
    });
  }
  items.sort((a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s !== 0) return s;
    return a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0;
  });

  // --- category breakdown (share of recent revenue applied to the projection) -----------------
  const totalCents = sum([...categoryCents.values()]);
  const categories = [];
  if (totalCents > 0) {
    const ordered = [...categoryCents.entries()].sort((a, b) => {
      if (a[1] !== b[1]) return b[1] - a[1];
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });
    for (const [name, cc] of ordered) {
      const share = cc / totalCents;
      categories.push({
        category: name,
        projectedRevenue: round(projectedGross * share, 2),
        percentShare: round(share * 100, 1),
      });
    }
  }

  return {
    kpis: {
      projectedGross,
      projectedNet,
      projectedDiscounts,
      discountRatePct: round(discountRatio * 100, 2),
      grossGrowth,
      highRiskSKUs: items.filter((i) => i.status !== STATUS_OK).length,
      horizonDays: horizon,
    },
    revenueTrajectory: trajectory,
    categoryBreakdown: categories,
    skuDemandList: items,
    meta: {
      source,
      engine: ENGINE_NAME,
      engineVersion: ENGINE_VERSION,
      asOf: payload.asOf,
      timezone: payload.timezone ?? null,
      historyDays,
      observedDays,
      rateWindowDays: RATE_WINDOW_DAYS,
      skuCount: items.length,
      lowData: observedDays < MIN_DAYS_FOR_GROWTH,
      warnings,
    },
  };
}

module.exports = {
  buildForecast,
  ENGINE_NAME,
  ENGINE_VERSION,
  STATUS_OK,
  STATUS_REORDER,
  STATUS_EXPIRY,
  dayNumber: day,
  isoFromDay: toIso,
};
