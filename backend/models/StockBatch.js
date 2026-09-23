const { prisma } = require('./Product');

// Every batch a product has ever had (received, exhausted or not), newest first — for the
// "Batches" tab on the Stock History modal. Read-only; batches are only ever written from inside
// another model's transaction (see models/stockBatches.js).
const StockBatchModel = {
  findByProduct: async (productId) => {
    const pid = parseInt(productId, 10);
    if (!pid) return [];
    return prisma.stockBatch.findMany({
      where: { productId: pid },
      include: { supplier: { select: { name: true } } },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
    });
  },
};

module.exports = { StockBatchModel };
