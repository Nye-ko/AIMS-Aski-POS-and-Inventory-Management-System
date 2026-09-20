const { prisma } = require('./Product');

const STOCK_MOVEMENT_TYPES = ['OPENING', 'PURCHASE_RECEIPT', 'MANUAL_ADD', 'SALE', 'PURCHASE_RETURN', 'ADJUSTMENT'];
const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

const movementInclude = {
  product: { select: { id: true, name: true, barcode: true, unit: true } },
  user: { select: { username: true } },
};

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

    return prisma.stockMovement.findMany({
      where,
      include: movementInclude,
      orderBy: { id: 'desc' },
      take,
    });
  },
};

module.exports = { StockMovementModel, STOCK_MOVEMENT_TYPES };
