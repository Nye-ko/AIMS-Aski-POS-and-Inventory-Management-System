// Supplier names typed by hand ("alpha  distributing", "Alpha Distributing ") should find the existing
// supplier instead of creating a near-duplicate, so names are compared ignoring case and extra spacing.
const MAX_SUPPLIER_NAME_LENGTH = 150;

// The name as it will be stored: trimmed, inner runs of whitespace collapsed, length-capped. '' if unusable.
const cleanSupplierName = (value) => {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_SUPPLIER_NAME_LENGTH).trim();
};

const supplierNameKey = (value) => cleanSupplierName(value).toLowerCase();

// The supplier whose name matches `name` (ignoring case and spacing), or null. Lowest id wins if there are duplicates.
const findSupplierByName = (suppliers, name) => {
  const key = supplierNameKey(name);
  if (!key) return null;
  let best = null;
  for (const s of suppliers) {
    if (supplierNameKey(s.name) === key && (best === null || s.id < best.id)) best = s;
  }
  return best;
};

module.exports = { cleanSupplierName, supplierNameKey, findSupplierByName, MAX_SUPPLIER_NAME_LENGTH };
