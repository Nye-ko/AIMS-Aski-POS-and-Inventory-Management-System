const test = require('node:test');
const assert = require('node:assert/strict');
const { attachAmounts } = require('../models/StockMovement');

const movement = (overrides) => ({
  id: 1,
  productId: 5,
  type: 'SALE',
  quantity: -2,
  balanceAfter: 8,
  referenceType: 'Transaction',
  referenceId: 100,
  reason: null,
  ...overrides,
});

test('a movement whose (referenceType, referenceId, productId) is in the map gets an amount', () => {
  const map = new Map([['Transaction:100:5', 240]]);
  const [m] = attachAmounts([movement()], map);
  assert.equal(m.amount, 240);
});

test('a movement with no matching entry is left without an amount field', () => {
  const [m] = attachAmounts([movement()], new Map());
  assert.equal('amount' in m, false);
});

test('movements with no reference (manual add, adjustment, opening) are never priced', () => {
  const rows = [
    movement({ type: 'MANUAL_ADD', referenceType: null, referenceId: null }),
    movement({ type: 'ADJUSTMENT', referenceType: null, referenceId: null }),
  ];
  // Even a map that happens to have a matching key must not be consulted without a reference.
  const map = new Map([['null:null:5', 999]]);
  for (const m of attachAmounts(rows, map)) assert.equal('amount' in m, false);
});

test('the same reference priced for two different products does not cross-contaminate', () => {
  const map = new Map([
    ['ReceivingReport:7:5', 500],
    ['ReceivingReport:7:6', 300],
  ]);
  const rows = [
    movement({ type: 'PURCHASE_RECEIPT', referenceType: 'ReceivingReport', referenceId: 7, productId: 5, quantity: 10 }),
    movement({ type: 'PURCHASE_RECEIPT', referenceType: 'ReceivingReport', referenceId: 7, productId: 6, quantity: 4 }),
  ];
  const [a, b] = attachAmounts(rows, map);
  assert.equal(a.amount, 500);
  assert.equal(b.amount, 300);
});

test('the original movement objects are not mutated', () => {
  const original = movement();
  attachAmounts([original], new Map([['Transaction:100:5', 240]]));
  assert.equal('amount' in original, false);
});
