const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveStockoutDays } = require('../models/stockHistory');

const derive = (args) => Object.fromEntries(deriveStockoutDays({ fromDay: '2026-09-08', lastDay: '2026-09-14', ...args }));

test('a day is a stock-out when the balance touched zero, until the shelf is refilled', () => {
  const out = derive({
    before: new Map([[1, 5]]),
    daily: [
      { productId: 1, date: '2026-09-10', minBalance: 0, endBalance: 0 }, // last unit sold
      { productId: 1, date: '2026-09-12', minBalance: 20, endBalance: 20 }, // refilled, but it opened empty
    ],
  });
  assert.deepEqual(out[1], ['2026-09-10', '2026-09-11', '2026-09-12']);
});

test('days before a product\'s first ledger entry are unknown, not stock-outs', () => {
  const out = derive({
    before: new Map(),
    daily: [{ productId: 2, date: '2026-09-10', minBalance: 0, endBalance: 0 }],
  });
  assert.deepEqual(out[2], ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14']);
  assert.deepEqual(derive({ before: new Map(), daily: [{ productId: 3, date: '2026-09-10', minBalance: 30, endBalance: 30 }] }), {});
});

test('a product with stock and no movements is never a stock-out; one sitting at zero always is', () => {
  const out = derive({ before: new Map([[4, 7], [5, 0]]), daily: [] });
  assert.equal(out[4], undefined);
  assert.equal(out[5].length, 7);
  assert.equal(out[5][0], '2026-09-08');
});

test('a dip to zero inside a day counts even if the day ends stocked', () => {
  const out = derive({
    before: new Map([[6, 3]]),
    daily: [{ productId: 6, date: '2026-09-09', minBalance: 0, endBalance: 40 }],
  });
  assert.deepEqual(out[6], ['2026-09-09']);
});
