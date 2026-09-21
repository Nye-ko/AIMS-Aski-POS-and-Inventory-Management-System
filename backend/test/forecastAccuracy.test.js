const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { summarize, gradeSnapshots } = require('../services/forecastAccuracy');
const { buildForecast, dayNumber, isoFromDay } = require('../services/forecastEngine');
const { buildSnapshot } = require('../services/forecastSnapshots');

const START = dayNumber('2026-08-01');
const iso = (offset) => isoFromDay(START + offset);

// product 1 sells `qty` per day for every day in [0, days)
const dailyUnits = (qty, days) => new Map([[1, new Map(Array.from({ length: days }, (_, i) => [START + i, qty]))]]);
const dailyGross = (amount, days) => new Map(Array.from({ length: days }, (_, i) => [START + i, amount]));
const snap = (offset, forecast7, rev7 = 0, rev30 = 0) => ({
  asOf: iso(offset),
  revenue7: rev7,
  revenue30: rev30,
  items: [{ productId: 1, sku: 'A', forecast7 }],
});

test('summarize computes WAPE, bias and verdicts like the Python backtest', () => {
  const s = summarize([...Array(5).fill([12, 10, 8]), ...Array(5).fill([8, 10, 12])]);
  assert.equal(s.model.wape, 0.2);
  assert.equal(s.model.bias, 0);
  assert.equal(s.model.mae, 2);
  assert.equal(summarize(Array(6).fill([10, 10, 20])).verdict, 'better');
  assert.equal(summarize(Array(6).fill([20, 10, 10])).verdict, 'worse');
  assert.equal(summarize(Array(6).fill([11, 10, 11])).verdict, 'similar');
  assert.equal(summarize(Array(4).fill([10, 10, 20])).verdict, 'insufficient');
  assert.equal(summarize([]).verdict, 'insufficient');
  assert.equal(summarize(Array(6).fill([1, 0, 1])).model.wape, null); // nothing sold: no division by zero
});

test('grades a snapshot once its 7 days are complete', () => {
  const r = gradeSnapshots({
    snapshots: [snap(20, 14)],
    unitsByProduct: dailyUnits(2, 40),
    grossByDay: dailyGross(100, 40),
    lastCompleteDay: iso(30),
    storeStart: START,
  });
  assert.equal(r.units7.n, 1);
  assert.equal(r.units7.model.wape, 0);
  assert.equal(r.meta.snapshotsGraded, 1);
});

test('measures under-forecasting as negative bias', () => {
  const r = gradeSnapshots({
    snapshots: [snap(20, 7)],
    unitsByProduct: dailyUnits(2, 40),
    grossByDay: dailyGross(100, 40),
    lastCompleteDay: iso(30),
    storeStart: START,
  });
  assert.equal(r.units7.model.wape, 0.5);
  assert.equal(r.units7.model.bias, -0.5);
});

test('skips snapshots whose outcome is not fully in the past yet', () => {
  const r = gradeSnapshots({
    snapshots: [snap(20, 14)],
    unitsByProduct: dailyUnits(2, 40),
    grossByDay: dailyGross(100, 40),
    lastCompleteDay: iso(24), // needs iso(26)
    storeStart: START,
  });
  assert.equal(r.units7.n, 0);
  assert.equal(r.meta.snapshotsSaved, 1);
  assert.equal(r.meta.snapshotsGraded, 0);
});

test('skips snapshots with too little history behind them to form a baseline', () => {
  const r = gradeSnapshots({
    snapshots: [snap(5, 14)],
    unitsByProduct: dailyUnits(2, 40),
    grossByDay: dailyGross(100, 40),
    lastCompleteDay: iso(39),
    storeStart: START,
  });
  assert.equal(r.units7.n, 0);
});

test('revenue is graded over 7 and 30 days only when those windows are complete', () => {
  const grade = (lastOffset) =>
    gradeSnapshots({
      snapshots: [snap(31, 14, 700, 3000)],
      unitsByProduct: dailyUnits(2, 80),
      grossByDay: dailyGross(100, 80),
      lastCompleteDay: iso(lastOffset),
      storeStart: START,
    });
  assert.equal(grade(40).revenue7.n, 1);
  assert.equal(grade(40).revenue30.n, 0);
  const full = grade(70);
  assert.equal(full.revenue30.n, 1);
  assert.equal(full.revenue30.model.wape, 0); // 30 * 100 = 3000
});

test('per-product errors are reported with the product sku', () => {
  const r = gradeSnapshots({
    snapshots: [snap(20, 7), snap(21, 14)],
    unitsByProduct: dailyUnits(2, 40),
    grossByDay: dailyGross(100, 40),
    lastCompleteDay: iso(35),
    storeStart: START,
  });
  assert.equal(r.perSku.length, 1);
  assert.equal(r.perSku[0].sku, 'A');
  assert.equal(r.perSku[0].n, 2);
});

const fixtures = path.join(__dirname, '..', '..', 'ai-service', 'tests', 'fixtures');
const fixtureInput = JSON.parse(fs.readFileSync(path.join(fixtures, 'forecast_input.json'), 'utf8'));

test('buildSnapshot stores revenue sums and only products that had history', () => {
  const forecast = buildForecast(fixtureInput, { source: 'ai-service' });
  const s = buildSnapshot(forecast);
  const future = forecast.revenueTrajectory.filter((p) => p.actual === null).map((p) => p.forecast);
  assert.equal(s.asOf, fixtureInput.asOf);
  assert.equal(s.model, 'rate-mean@1.0.0');
  assert.equal(s.revenue7, Math.round(future.slice(0, 7).reduce((a, b) => a + b, 0) * 100) / 100);
  assert.equal(s.revenue30, Math.round(future.slice(0, 30).reduce((a, b) => a + b, 0) * 100) / 100);
  assert.equal(s.items.length, forecast.skuDemandList.filter((i) => i.dataDays > 0).length);
});

test('buildSnapshot returns null when there is nothing to grade', () => {
  const empty = buildForecast({ asOf: '2026-09-21', daysToForecast: 30, products: [], sales: [], dailyTotals: [] });
  assert.equal(buildSnapshot(empty), null);
  const short = buildForecast({ ...fixtureInput, daysToForecast: 10 });
  assert.equal(buildSnapshot(short), null); // needs a 30-day path
  assert.equal(buildSnapshot(null), null);
});
