const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanSupplierName, supplierNameKey, findSupplierByName, MAX_SUPPLIER_NAME_LENGTH } = require('../services/supplierName');

test('names are trimmed and inner spacing is collapsed', () => {
  assert.equal(cleanSupplierName('  Alpha   Distributing \n'), 'Alpha Distributing');
  assert.equal(cleanSupplierName('Alpha\tDistributing'), 'Alpha Distributing');
});

test('unusable input becomes an empty string', () => {
  for (const v of [undefined, null, 42, {}, '', '   ', '\n\t']) assert.equal(cleanSupplierName(v), '');
});

test('very long names are capped without leaving trailing space', () => {
  const cleaned = cleanSupplierName(`${'a'.repeat(MAX_SUPPLIER_NAME_LENGTH - 1)} ${'b'.repeat(50)}`);
  assert.ok(cleaned.length <= MAX_SUPPLIER_NAME_LENGTH);
  assert.equal(cleaned, cleaned.trim());
});

test('matching ignores case and extra spacing and prefers the oldest supplier', () => {
  const list = [
    { id: 7, name: 'Beta Foods' },
    { id: 9, name: 'alpha  distributing' },
    { id: 3, name: 'Alpha Distributing' },
  ];
  assert.equal(supplierNameKey('  ALPHA distributing '), 'alpha distributing');
  assert.equal(findSupplierByName(list, 'ALPHA   DISTRIBUTING').id, 3);
  assert.equal(findSupplierByName(list, 'beta foods').id, 7);
  assert.equal(findSupplierByName(list, 'Alpha'), null); // a partial name is a different supplier
  assert.equal(findSupplierByName(list, '   '), null);
  assert.equal(findSupplierByName([], 'Alpha Distributing'), null);
});
