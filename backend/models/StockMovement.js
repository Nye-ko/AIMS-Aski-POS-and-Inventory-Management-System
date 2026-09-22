const { prisma } = require('./Product');

const STOCK_MOVEMENT_TYPES = ['OPENING', 'PURCHASE_RECEIPT', 'MANUAL_ADD', 'SALE', 'PURCHASE_RETURN', 'ADJUSTMENT'];
const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;
// A hard ceiling on a single product's exported ledger, so a runaway export can't fetch the whole table.
const MAX_EXPORT_ROWS = 20000;

const movementInclude = {
  product: { select: { id: true, name: true, barcode: true, unit: true } },
  user: { select: { username: true } },
};

// Movements carry no price of their own (the ledger only records the quantity change), so a movement's
// money value — sale revenue, purchase cost, or a return's credit — is looked up from the document it
// references. Table/column names for each referenceType that can be priced this way.
const AMOUNT_SOURCES = {
  Transaction: { table: 'transactionItem', fk: 'transactionId' },
  ReceivingReport: { table: 'receivingReportItem', fk: 'receivingReportId' },
  PurchaseReturn: { table: 'purchaseReturnItem', fk: 'purchaseReturnId' },
};

// Pure and DB-free: given movements and a `${referenceType}:${referenceId}:${productId}` -> amount map
// (see loadAmounts), returns the movements with an `amount` field added wherever one was found. The sign
// always follows the source line's subtotal (unsigned money value); the movement's own `quantity` already
// says which direction it went.
const attachAmounts = (movements, amountByKey) =>
  movements.map((m) => {
    if (!m.referenceType || m.referenceId == null) return m;
    const amount = amountByKey.get(`${m.referenceType}:${m.referenceId}:${m.productId}`);
    return amount === undefined ? m : { ...m, amount };
  });

// One batched query per source table (never one query per movement). Rows for a given
// (referenceId, productId) pair are summed, in case a document ever lists a product twice.
const loadAmounts = async (movements) => {
  const amountByKey = new Map();
  const byType = new Map();
  for (const m of movements) {
    if (!m.referenceType || m.referenceId == null || !AMOUNT_SOURCES[m.referenceType]) continue;
    if (!byType.has(m.referenceType)) byType.set(m.referenceType, { refIds: new Set(), productIds: new Set() });
    const bucket = byType.get(m.referenceType);
    bucket.refIds.add(m.referenceId);
    bucket.productIds.add(m.productId);
  }

  await Promise.all(
    [...byType.entries()].map(async ([referenceType, { refIds, productIds }]) => {
      const { table, fk } = AMOUNT_SOURCES[referenceType];
      const rows = await prisma[table].findMany({
        where: { [fk]: { in: [...refIds] }, productId: { in: [...productIds] } },
        select: { [fk]: true, productId: true, subtotal: true },
      });
      for (const row of rows) {
        const key = `${referenceType}:${row[fk]}:${row.productId}`;
        amountByKey.set(key, (amountByKey.get(key) || 0) + Number(row.subtotal));
      }
    }),
  );

  return amountByKey;
};

const withAmounts = async (movements) => attachAmounts(movements, await loadAmounts(movements));

const StockMovementModel = {
  // Newest first. `before` is the id of the last row already loaded (cursor pagination).
  findAll: async ({ productId, type, from, to, limit, before } = {}) => {
    const where = {};
    const pid = parseInt(productId, 10);
    if (pid) where.productId = pid;
    if (type) where.type = type;

    const createdAt = {};
    if (from) {
      const d = new Date(from);
      if (!Number.isNaN(d.getTime())) createdAt.gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (!Number.isNaN(d.getTime())) {
        // A bare YYYY-MM-DD should include that whole day.
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(to))) d.setHours(23, 59, 59, 999);
        createdAt.lte = d;
      }
    }
    if (Object.keys(createdAt).length) where.createdAt = createdAt;

    const cursor = parseInt(before, 10);
    if (cursor) where.id = { lt: cursor };

    const take = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    const movements = await prisma.stockMovement.findMany({
      where,
      include: movementInclude,
      orderBy: { id: 'desc' },
      take,
    });
    return withAmounts(movements);
  },

  // One product's whole ledger, oldest first (reads like a statement), for the "Export" button on Stock
  // History — unpaginated, unlike findAll, but capped at MAX_EXPORT_ROWS so it can't run away.
  findAllForExport: async ({ productId, type, from, to } = {}) => {
    const pid = parseInt(productId, 10);
    if (!pid) return [];
    const where = { productId: pid };
    if (type) where.type = type;

    const createdAt = {};
    if (from) {
      const d = new Date(from);
      if (!Number.isNaN(d.getTime())) createdAt.gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (!Number.isNaN(d.getTime())) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(to))) d.setHours(23, 59, 59, 999);
        createdAt.lte = d;
      }
    }
    if (Object.keys(createdAt).length) where.createdAt = createdAt;

    const movements = await prisma.stockMovement.findMany({
      where,
      include: movementInclude,
      orderBy: { id: 'asc' },
      take: MAX_EXPORT_ROWS,
    });
    return withAmounts(movements);
  },
};

module.exports = { StockMovementModel, STOCK_MOVEMENT_TYPES, attachAmounts, AMOUNT_SOURCES };
