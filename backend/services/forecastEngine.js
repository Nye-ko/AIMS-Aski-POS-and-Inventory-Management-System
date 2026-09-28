// Deterministic demand & revenue forecast engine — the JavaScript twin of ai-service/forecast_engine.py.
//
// Used as the fallback when the Python service is unreachable, so the dashboard and the daily email show
// the same numbers either way instead of made-up ones. The two implementations are held identical by a
// shared golden fixture (ai-service/tests/fixtures, checked by backend/test/forecastEngine.test.js):
// change one, change the other, regenerate the fixture with `python tests/make_fixture.py`.
//
// Engine "rate-mean" 2.0.0: a product's demand rate is units per calendar day over its last 28 days,
// zero days included but days it was out of stock skipped; store revenue uses the last 14 days; every
// forecast carries an 80% range. Reorder decisions (2.1.0): reorder point = expected demand over the
// supplier's lead time + 95% safety stock, never below minStock; flagged when on hand + on order is at
// or below it. A day with no sales anywhere in the store (not one product's stock-out, but the whole
// store recording nothing -- e.g. a gap between an imported history and this system going live) is
// skipped the same way, so it never gets counted as "zero demand" -- unless too little real trading
// history would be left in the window, in which case (2.2.0) the engine reaches further back, up to
// the full history lookback, for the most recent real trading days instead of giving up and counting
// the gap as zero; a warning notes when this happened. The revenue trajectory chart (2.3.0) is reshaped
// by day-of-week -- learned from real (non-simulated) trading days across the full history, each weekday
// trusted only with MIN_WEEKDAY_OBS real observations, otherwise left flat -- but this never changes the
// KPI totals (projectedGross etc.) or per-SKU demand, which still use the plain flat rate: only the
// chart's daily split changes. See the header of ai-service/forecast_engine.py for the reasoning.
//
// Money is summed in integer cents so results do not depend on row order. Dates are ISO "YYYY-MM-DD"
// strings in the store's local time zone.

const { SERVICE_Z, windowMean, sampleVariance, totalSd, rangeForTotal } = require('./forecastStats');

const ENGINE_NAME = 'rate-mean';
const ENGINE_VERSION = '2.3.0';

const RATE_WINDOW_DAYS = 28; // a product's demand rate
const REVENUE_WINDOW_DAYS = 14; // the store's revenue rate
const TRAJECTORY_HISTORY_DAYS = 30;
const MIN_WEEKDAY_OBS = 4; // real (non-simulated) trading days needed before trusting a weekday's shape
const WEEKDAYS = 7;
const EXPIRY_HORIZON_DAYS = 180;
const MIN_DAYS_FOR_GROWTH = 14;
const MIN_USABLE_DAYS = 7; // fewer in-stock days than this in the window: stock-outs are not excluded
const DEFAULT_LEAD_TIME_DAYS = 7; // used when a product's supplier has no lead time
const REVIEW_DAYS = 7; // how often stock is reviewed: a reorder covers lead time plus this many days
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
const weekdayOf = (n) => new Date(n * MS_PER_DAY).getUTCDay(); // 0=Sun..6=Sat

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

  // --- days each product was out of stock (its zero sales there are not demand) ---------------
  const stockoutDays = new Map(); // sku -> Set(day)
  for (const s of payload.stockouts || []) {
    const d = day(s.date);
    if (d >= windowStart && d <= windowEnd && known.has(s.sku)) {
      if (!stockoutDays.has(s.sku)) stockoutDays.set(s.sku, new Set());
      stockoutDays.get(s.sku).add(d);
    }
  }

  // --- store-level daily gross / discount (cents) ---------------------------------------------
  const storeDays = new Map(); // day -> [gross, discount]
  // Days made entirely of synthetic (SIM-*) transactions -- a data-gap fill with no real day-of-week
  // signal (see salesHistory.js). Still counted toward the store's level/rate, just not its weekday shape.
  const simulatedDays = new Set();
  const totals = payload.dailyTotals || [];
  if (totals.length) {
    for (const t of totals) {
      const d = day(t.date);
      if (d >= windowStart && d <= windowEnd) {
        if (!storeDays.has(d)) storeDays.set(d, [0, 0]);
        const cell = storeDays.get(d);
        cell[0] += cents(t.gross);
        cell[1] += cents(t.discount);
        if (t.simulated) simulatedDays.add(d);
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

  // --- store revenue: rate, range, discounts, growth -----------------------------------------
  let rateCents = 0;
  let levelDays = 1;
  let storeVariance = null;
  let discountRatio = 0;
  let growthPct = null;
  let idleDays = 0; // days with no sales anywhere in the store, actually skipped (reported in meta)
  let staleSinceDays = null; // set when the rate had to be learned from trading days older than the usual window
  if (storeStart !== null) {
    const first = Math.max(storeStart, windowEnd - RATE_WINDOW_DAYS + 1);
    const spanDays = windowEnd - first + 1;
    let idleInSpan = 0;
    for (let d = first; d <= windowEnd; d += 1) if (!storeDays.has(d)) idleInSpan += 1;
    // A day with no sales anywhere in the store (not just one product out of stock) says nothing
    // about demand -- the store simply wasn't recording sales that day (e.g. a gap between an
    // imported history and this system going live). Skip it like a stock-out, unless doing so
    // would leave too little real trading history in the window to learn from.
    const skipIdle = idleInSpan > 0 && spanDays - idleInSpan >= MIN_USABLE_DAYS;
    if (skipIdle) idleDays = idleInSpan;
    let recent;
    if (idleInSpan === 0 || skipIdle) {
      recent = [];
      for (let d = first; d <= windowEnd; d += 1) recent.push(skipIdle && !storeDays.has(d) ? null : storeGross(d));
    } else {
      // The normal window doesn't have enough real trading days to learn from even after skipping
      // idle ones -- the gap itself has outgrown the window (e.g. a month or more between an
      // imported history and this system going live). Reach further back, up to the full history
      // lookback, for the most recent real trading days instead of averaging in a long run of zeros.
      recent = [];
      let oldest = null;
      for (let d = windowEnd; d >= windowStart && recent.length < REVENUE_WINDOW_DAYS; d -= 1) {
        if (storeDays.has(d)) { recent.unshift(storeGross(d)); oldest = d; }
      }
      if (recent.length < MIN_USABLE_DAYS) {
        // Even the full history doesn't have enough real trading days -- there is truly nothing
        // reliable to learn from, so fall back to the plain calendar-window average (the gap
        // counts as zero) same as before, rather than trusting a handful of very old points.
        recent = [];
        for (let d = first; d <= windowEnd; d += 1) recent.push(storeGross(d));
      } else if (oldest !== null && oldest < first) {
        staleSinceDays = windowEnd - oldest;
      }
    }
    const level = windowMean(recent, REVENUE_WINDOW_DAYS);
    rateCents = level ? level.mean : 0;
    levelDays = level ? level.count : 1;
    storeVariance = sampleVariance(recent);

    const totalGross = sum([...storeDays.values()].map((v) => v[0]));
    const totalDiscount = sum([...storeDays.values()].map((v) => v[1]));
    discountRatio = totalGross > 0 ? totalDiscount / totalGross : 0;
    // Trading days only, not the calendar span -- a day the store recorded nothing shouldn't drag
    // the historical average down just because it sits inside the window.
    const tradingDays = storeDays.size;
    const histAvg = tradingDays > 0 ? totalGross / tradingDays : 0;
    if (observedDays >= MIN_DAYS_FOR_GROWTH && histAvg > 0) {
      growthPct = round((rateCents / histAvg - 1) * 100, 1);
    }
  }
  if (idleDays > 0) warnings.push(`${idleDays} day(s) with no store-wide sales were treated as no data, not zero demand.`);
  if (staleSinceDays !== null) {
    warnings.push(`No recent store-wide sales in the last ${RATE_WINDOW_DAYS} days; revenue is estimated from the most recent real trading day(s), up to ${staleSinceDays} day(s) ago.`);
  }

  // --- weekday shape for the trajectory (2.3.0): the flat rate above is never changed, only how it's
  // split across the chart's daily points -- learned from real (non-simulated) trading days across the
  // full history window, each weekday trusted only once it has MIN_WEEKDAY_OBS real observations.
  const weekdaySum = new Array(WEEKDAYS).fill(0);
  const weekdayCount = new Array(WEEKDAYS).fill(0);
  let realTotalCents = 0;
  let realDayCount = 0;
  for (const [d, [gross]] of storeDays) {
    if (simulatedDays.has(d)) continue;
    const wd = weekdayOf(d);
    weekdaySum[wd] += gross;
    weekdayCount[wd] += 1;
    realTotalCents += gross;
    realDayCount += 1;
  }
  const overallMean = realDayCount > 0 ? realTotalCents / realDayCount : 0;
  const weekdayFactor = new Array(WEEKDAYS).fill(1);
  let shapedWeekdays = 0;
  if (overallMean > 0) {
    for (let wd = 0; wd < WEEKDAYS; wd += 1) {
      if (weekdayCount[wd] >= MIN_WEEKDAY_OBS) {
        weekdayFactor[wd] = weekdaySum[wd] / weekdayCount[wd] / overallMean;
        shapedWeekdays += 1;
      }
    }
  }
  if (shapedWeekdays === 0) {
    warnings.push('Not enough real trading history yet to shape the forecast by day of week; showing a flat daily average.');
  }

  const [lowCents, highCents] = rangeForTotal(rateCents, levelDays, storeVariance, horizon);
  const projectedGross = round((rateCents * horizon) / 100, 2);
  const projectedLow = round(lowCents / 100, 2);
  const projectedHigh = round(highCents / 100, 2);
  const projectedDiscounts = round(projectedGross * discountRatio, 2);
  const projectedNet = round(projectedGross - projectedDiscounts, 2);
  const grossGrowth = growthPct === null ? 'n/a' : `${growthPct >= 0 ? '+' : '-'}${Math.abs(growthPct).toFixed(1)}%`;

  // --- trajectory: recent actuals, then the daily forecast with its range --------------------
  const trajectory = [];
  if (storeStart !== null) {
    const first = Math.max(storeStart, windowEnd - TRAJECTORY_HISTORY_DAYS + 1);
    for (let d = first; d <= windowEnd; d += 1) {
      trajectory.push({
        day: label(d),
        date: toIso(d),
        actual: round(storeGross(d) / 100, 2),
        forecast: null,
        forecastLow: null,
        forecastHigh: null,
      });
    }
    const joint = trajectory[trajectory.length - 1]; // join the two lines
    joint.forecast = joint.actual;
    joint.forecastLow = joint.actual;
    joint.forecastHigh = joint.actual;
    const [dayLow, dayHigh] = rangeForTotal(rateCents, levelDays, storeVariance, 1);
    const lowMargin = rateCents - dayLow; // kept constant per day, just recentered on the shaped value
    const highMargin = dayHigh - rateCents;
    // Reshape the flat rate by weekday, then rescale the horizon's days so their sum still equals
    // rateCents * horizon exactly -- the KPI totals above never change, only the daily split.
    const rawShaped = [];
    for (let i = 0; i < horizon; i += 1) rawShaped.push(rateCents * weekdayFactor[weekdayOf(asOf + i)]);
    const rawSum = sum(rawShaped);
    const shapeScale = rawSum > 0 ? (rateCents * horizon) / rawSum : 1;
    for (let i = 0; i < horizon; i += 1) {
      const d = asOf + i;
      const shaped = rawShaped[i] * shapeScale;
      trajectory.push({
        day: label(d),
        date: toIso(d),
        actual: null,
        forecast: round(shaped / 100, 2),
        forecastLow: round(Math.max(0, shaped - lowMargin) / 100, 2),
        forecastHigh: round((shaped + highMargin) / 100, 2),
      });
    }
  }

  // --- per-SKU demand and status --------------------------------------------------------------
  const items = [];
  const categoryCents = new Map();
  let staleSkuCount = 0; // products whose demand rate had to reach past the usual window (see below)
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
    let c = 0;
    let rate = 0;
    let low7 = 0;
    let high7 = 0;
    let sdLead = 0;
    let sdCycle = 0;
    const lead = Math.max(1, Math.trunc(Number(p.leadTimeDays)) || DEFAULT_LEAD_TIME_DAYS);
    let stockouts = 0;
    let adjusted = false;
    if (skuStart !== null && skuStart <= windowEnd) {
      const rateStart = Math.max(skuStart, windowEnd - RATE_WINDOW_DAYS + 1);
      for (let d = rateStart; d <= windowEnd; d += 1) {
        const cell = byDay.get(d);
        if (cell) c += cell[1];
      }

      // A day is excluded from this product's rate either because it was personally out of stock,
      // or because the whole store recorded no sales that day (see the store-revenue block above)
      // -- neither kind of zero says anything about this product's demand.
      const outOfStock = stockoutDays.get(p.sku) || new Set();
      let excluded = new Set();
      for (let d = rateStart; d <= windowEnd; d += 1) {
        if (outOfStock.has(d) || !storeDays.has(d)) excluded.add(d);
      }
      const spanDays = windowEnd - rateStart + 1;
      let recent;
      if (excluded.size && spanDays - excluded.size < MIN_USABLE_DAYS) {
        // Too little real, in-stock trading history inside the normal window -- the gap has
        // outgrown the window itself. Reach further back, up to the full history lookback, for the
        // most recent days this product actually had a chance to sell on, instead of giving up and
        // averaging in a long run of zeros (see the store-revenue block above for the same idea).
        excluded = new Set();
        recent = [];
        let oldest = null;
        const reachBack = Math.max(skuStart, windowStart);
        for (let d = windowEnd; d >= reachBack && recent.length < RATE_WINDOW_DAYS; d -= 1) {
          if (!outOfStock.has(d) && storeDays.has(d)) { recent.unshift((byDay.get(d) || [0, 0])[0]); oldest = d; }
        }
        if (recent.length < MIN_USABLE_DAYS) {
          // Not enough real, in-stock trading days anywhere in history either -- fall back to the
          // plain calendar-window average (stock-outs/gaps count as zero) same as before.
          recent = [];
          for (let d = rateStart; d <= windowEnd; d += 1) recent.push((byDay.get(d) || [0, 0])[0]);
        } else if (oldest !== null && oldest < rateStart) {
          staleSkuCount += 1;
        }
      } else {
        recent = [];
        for (let d = rateStart; d <= windowEnd; d += 1) recent.push(excluded.has(d) ? null : (byDay.get(d) || [0, 0])[0]);
      }
      for (let d = rateStart; d <= windowEnd; d += 1) if (outOfStock.has(d) && excluded.has(d)) stockouts += 1;
      adjusted = stockouts > 0;

      const level = windowMean(recent, RATE_WINDOW_DAYS);
      rate = level ? level.mean : 0;
      dataDays = level ? level.count : 0;
      const variance = sampleVariance(recent);
      [low7, high7] = rangeForTotal(rate, dataDays, variance, 7, true);
      sdLead = totalSd(rate, dataDays, variance, lead, true);
      sdCycle = totalSd(rate, dataDays, variance, lead + REVIEW_DAYS, true);
    }

    const stock = Math.max(0, Math.trunc(Number(p.stock) || 0));
    const onOrder = Math.max(0, Math.trunc(Number(p.onOrder) || 0));
    const minStock = Math.trunc(Number(p.minStock) || 0);
    const forecast7 = rate * 7;
    const daysToExpiry = p.expiryDate ? day(p.expiryDate) - asOf : null;
    const sellable = daysToExpiry !== null && daysToExpiry <= 0 ? 0 : stock; // expired stock cannot be sold
    const safety = SERVICE_Z * sdLead;
    const reorderPoint = Math.max(Math.ceil(rate * lead + safety - EPS) + 0, minStock);
    const orderUpTo = Math.max(Math.ceil(rate * (lead + REVIEW_DAYS) + SERVICE_Z * sdCycle - EPS) + 0, reorderPoint);
    const position = sellable + onOrder;
    const needsOrder = reorderPoint > 0 && position <= reorderPoint;

    let status;
    if (daysToExpiry !== null && daysToExpiry <= 0 && stock > 0) {
      status = STATUS_EXPIRY; // already expired stock
    } else if (needsOrder) {
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
      minStock,
      dailyDemand: round(rate, 2),
      forecast7Day: round(forecast7, 1),
      forecast7Low: round(low7, 1),
      forecast7High: round(high7, 1),
      forecastHorizon: round(rate * horizon, 1),
      leadTimeDays: lead,
      onOrder,
      safetyStock: round(safety, 1),
      reorderPoint,
      orderUpTo,
      reorderQty: needsOrder ? Math.max(1, orderUpTo - position) : 0,
      daysOfCover: rate > 0 ? round(stock / rate, 1) : null,
      status,
      confidence: confidence(dataDays),
      dataDays,
      stockoutDays: stockouts,
      stockoutAdjusted: adjusted,
    });
  }
  if (staleSkuCount > 0) {
    warnings.push(`${staleSkuCount} product(s) have no recent sales in the last ${RATE_WINDOW_DAYS} days; their demand is estimated from older trading days instead.`);
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
      projectedGrossLow: projectedLow,
      projectedGrossHigh: projectedHigh,
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
      idleDays,
      rateWindowDays: RATE_WINDOW_DAYS,
      revenueWindowDays: REVENUE_WINDOW_DAYS,
      rangeLevel: 0.8,
      serviceLevel: 0.95,
      reviewDays: REVIEW_DAYS,
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
