// Run with: npm test   (node's built-in test runner; no extra dependencies)
// Proves the JavaScript fallback engine gives exactly the same forecast as the Python service.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildForecast } = require('../services/forecastEngine');

const fixtures = path.join(__dirname, '..', '..', 'ai-service', 'tests', 'fixtures');
const input = JSON.parse(fs.readFileSync(path.join(fixtures, 'forecast_input.json'), 'utf8'));
const expected = JSON.parse(fs.readFileSync(path.join(fixtures, 'forecast_expected.json'), 'utf8'));

test('JS engine matches the Python golden fixture (fallback parity)', () => {
  const actual = buildForecast(input, { source: 'ai-service' });
  assert.deepEqual(actual, expected);
});

test('marks fallback output with its source', () => {
  assert.equal(buildForecast(input).meta.source, 'fallback');
});

test('is deterministic and independent of row order', () => {
  const shuffled = structuredClone(input);
  shuffled.sales.reverse();
  shuffled.dailyTotals.reverse();
  shuffled.products.reverse();
  assert.deepEqual(buildForecast(shuffled), buildForecast(input));
});

test('empty history returns a valid response instead of throwing', () => {
  const r = buildForecast({ asOf: '2026-09-21', daysToForecast: 30, products: [], sales: [], dailyTotals: [] });
  assert.equal(r.kpis.projectedGross, 0);
  assert.deepEqual(r.revenueTrajectory, []);
  assert.ok(r.meta.warnings.length > 0);
});

test('forecast trajectory is reshaped by weekday, not a ramp, and its total matches the flat projection', () => {
  const result = buildForecast(input);
  const future = result.revenueTrajectory.filter((p) => p.actual === null);
  assert.equal(future.length, 30);
  // Same weekday always forecasts the same value (it's a repeating weekly shape, not a monotonic trend).
  const byWeekday = new Map();
  for (const p of future) {
    const wd = new Date(`${p.date}T00:00:00Z`).getUTCDay();
    if (!byWeekday.has(wd)) byWeekday.set(wd, []);
    byWeekday.get(wd).push(p.forecast);
  }
  for (const values of byWeekday.values()) {
    for (const v of values) assert.equal(v, values[0]);
  }
  // Reshaping only redistributes the same flat total across the week; it never changes the KPI totals.
  const total = future.reduce((sum, p) => sum + p.forecast, 0);
  assert.ok(Math.abs(total - result.kpis.projectedGross) < 1);
});
