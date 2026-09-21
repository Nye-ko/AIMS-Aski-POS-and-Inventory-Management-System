const test = require('node:test');
const assert = require('node:assert/strict');
const { windowMean, sampleVariance, rangeForTotal, INTERVAL_Z } = require('../services/forecastStats');
const { buildForecast } = require('../services/forecastEngine');

test('windowMean uses only the last days and skips unobserved ones', () => {
  assert.deepEqual(windowMean([100, 100, 2, 4], 2), { mean: 3, count: 2 });
  assert.deepEqual(windowMean([1, 2, 3], 28), { mean: 2, count: 3 });
  assert.deepEqual(windowMean([4, null, 4, null], 4), { mean: 4, count: 2 });
  assert.equal(windowMean([null, null], 5), null);
  assert.equal(windowMean([], 5), null);
});

test('sampleVariance needs two observations and ignores unobserved days', () => {
  assert.ok(Math.abs(sampleVariance([2, 4, 4, 4, 5, 5, 7, 9]) - 32 / 7) < 1e-12);
  assert.equal(sampleVariance([5]), null);
  assert.equal(sampleVariance([5, null]), null);
  assert.equal(sampleVariance([1, null, 3]), sampleVariance([1, 3]));
});

test('rangeForTotal follows the formula, floors at zero and applies Poisson only to counts', () => {
  const [low, high] = rangeForTotal(10, 28, 25, 7);
  const sd = Math.sqrt(7 * 25 + (49 * 25) / 28);
  assert.ok(Math.abs(low - (70 - INTERVAL_Z * sd)) < 1e-9);
  assert.ok(Math.abs(high - (70 + INTERVAL_Z * sd)) < 1e-9);
  assert.equal(rangeForTotal(0.2, 5, 4, 7)[0], 0);
  assert.deepEqual(rangeForTotal(6, 28, 0, 7, false), [42, 42]);
  const [pl, ph] = rangeForTotal(6, 28, 0, 7, true);
  assert.ok(pl < 42 && ph > 42);
  assert.deepEqual(rangeForTotal(3, 1, null, 7, true), rangeForTotal(3, 1, 3, 7, true));
});

const asOf = '2026-09-21';
const daysBack = (k) => new Date(Date.parse(`${asOf}T00:00:00Z`) - k * 86400000).toISOString().slice(0, 10);
const product = { id: 1, sku: 'A', name: 'A', category: 'Cat', stock: 0, minStock: 0, expiryDate: null, createdAt: '2026-01-01' };
const run = (gaps, stockouts) => {
  const sales = [];
  for (let k = 1; k <= 28; k += 1) {
    if (!gaps.includes(k)) sales.push({ sku: 'A', date: daysBack(k), quantity: 4, revenue: 40 });
  }
  return buildForecast({ asOf, daysToForecast: 30, products: [product], sales, dailyTotals: [], stockouts }).skuDemandList[0];
};

test('days out of stock are not counted as zero demand', () => {
  const gaps = [2, 3, 9, 10, 16, 17];
  const out = gaps.map((k) => ({ sku: 'A', date: daysBack(k) }));
  assert.equal(run(gaps, []).dailyDemand, Math.round(((4 * 22) / 28) * 100) / 100);
  const aware = run(gaps, out);
  assert.equal(aware.dailyDemand, 4);
  assert.equal(aware.stockoutDays, 6);
  assert.equal(aware.stockoutAdjusted, true);
  assert.equal(aware.dataDays, 22);
});

test('a product that was nearly always sold out is not excluded', () => {
  const gaps = Array.from({ length: 24 }, (_, i) => i + 1);
  const aware = run(gaps, gaps.map((k) => ({ sku: 'A', date: daysBack(k) })));
  assert.equal(aware.stockoutDays, 0);
  assert.equal(aware.stockoutAdjusted, false);
});

test('forecast sits inside its 80% range', () => {
  const r = buildForecast({
    asOf,
    daysToForecast: 30,
    products: [product],
    sales: Array.from({ length: 30 }, (_, i) => ({ sku: 'A', date: daysBack(i + 1), quantity: (i * 7) % 9, revenue: ((i * 7) % 9) * 25 })),
    dailyTotals: [],
  });
  const a = r.skuDemandList[0];
  assert.ok(a.forecast7Low <= a.forecast7Day && a.forecast7Day <= a.forecast7High);
  assert.ok(r.kpis.projectedGrossLow <= r.kpis.projectedGross && r.kpis.projectedGross <= r.kpis.projectedGrossHigh);
});
