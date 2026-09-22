const { prisma } = require('./Product');
const { PurchasingError } = require('./PurchaseOrder');
const { changeStock, StockError } = require('./stockLedger');

// PR-YYYYMMDD-#### — date-stamped, uniqueness guaranteed by the row's own id
const generatePrNumber = (id, date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `PR-${y}${m}${d}-${String(id).padStart(4, '0')}`;
};

const returnInclude = {
  supplier: true,
  createdBy: { select: { username: true } },
  items: { include: { product: true, receivingReport: { select: { id: true, rrNumber: true, receivedAt: true } } } },
};

const PurchaseReturnModel = {
  // File a Purchase Return against a supplier: each line names which Receiving Report (delivery
  // batch) it's drawn from, so a single return can pull items across several of that supplier's
  // deliveries at once. Decrements product stock by the returned quantity (cost price untouched).
  // Every line is capped at what its own receiving report received minus everything already
  // returned against that same report.
  create: async ({ supplierId, items, reason, remarks, createdById }) => {
    const supId = parseInt(supplierId, 10);
    if (!supId) throw new PurchasingError(400, 'supplierId is required');
    if (!Array.isArray(items) || items.length === 0) throw new PurchasingError(400, 'At least one returned item is required');
    const cleanReason = typeof reason === 'string' ? reason.trim().slice(0, 255) : '';
    if (!cleanReason) throw new PurchasingError(400, 'A reason for the return is required');

    // createdById is set by the route handler from the authenticated user's
    // JWT — verify it still resolves to a real user.
    const validCreatedById = Number(createdById);
    const userExists = await prisma.user.findUnique({ where: { id: validCreatedById } });
    if (!userExists) throw new Error('Authenticated user no longer exists.');

    const seen = new Set();
    const requested = items.map((item) => {
      const receivingReportId = parseInt(item.receivingReportId, 10);
      const productId = parseInt(item.productId, 10);
      const quantity = parseInt(item.quantity, 10);
      if (!receivingReportId || !productId || !(quantity > 0)) {
        throw new PurchasingError(400, 'Each returned item requires a valid receivingReportId, productId, and quantity');
      }
      const key = `${receivingReportId}:${productId}`;
      if (seen.has(key)) throw new PurchasingError(400, 'A product can only appear once per receiving report on a purchase return');
      seen.add(key);
      return { receivingReportId, productId, quantity };
    });

    // Every receiving report this return touches, locked in a fixed (ascending id) order so two
    // returns pulling from overlapping batches never deadlock each other.
    const rrIds = [...new Set(requested.map((r) => r.receivingReportId))].sort((a, b) => a - b);

    return prisma.$transaction(async (tx) => {
      for (const id of rrIds) {
        const locked = await tx.$queryRaw`SELECT id FROM "ReceivingReport" WHERE id = ${id} FOR UPDATE`;
        if (locked.length === 0) throw new PurchasingError(404, `Receiving report ${id} not found`);
      }

      const receivingReports = await tx.receivingReport.findMany({
        where: { id: { in: rrIds } },
        include: { items: { include: { product: true } } },
      });
      const rrById = new Map(receivingReports.map((rr) => [rr.id, rr]));
      for (const id of rrIds) {
        if (!rrById.has(id)) throw new PurchasingError(404, `Receiving report ${id} not found`);
      }
      for (const rr of receivingReports) {
        if (rr.supplierId !== supId) throw new PurchasingError(400, `${rr.rrNumber} was not delivered by this supplier`);
      }

      const priorReturns = await tx.purchaseReturnItem.groupBy({
        by: ['receivingReportId', 'productId'],
        where: { receivingReportId: { in: rrIds } },
        _sum: { quantity: true },
      });
      const alreadyReturned = new Map(priorReturns.map((r) => [`${r.receivingReportId}:${r.productId}`, r._sum.quantity || 0]));

      const lineItems = requested.map(({ receivingReportId, productId, quantity }) => {
        const rr = rrById.get(receivingReportId);
        const receivedItem = rr.items.find((ri) => ri.productId === productId);
        if (!receivedItem) {
          throw new PurchasingError(400, `Product ${productId} was not part of receiving report ${rr.rrNumber}`);
        }
        const key = `${receivingReportId}:${productId}`;
        const returnable = receivedItem.quantity - (alreadyReturned.get(key) || 0);
        if (quantity > returnable) {
          throw new PurchasingError(
            409,
            `Cannot return ${quantity} of "${receivedItem.product.name}" — only ${Math.max(returnable, 0)} of the ${receivedItem.quantity} received on ${rr.rrNumber} can still be returned`,
          );
        }

        const unitCostCents = Math.round(Number(receivedItem.unitCost) * 100);
        return {
          receivingReportId,
          productId,
          quantity,
          unitCost: unitCostCents / 100,
          subtotal: (quantity * unitCostCents) / 100,
          productName: receivedItem.product.name,
        };
      });

      const created = await tx.purchaseReturn.create({
        data: {
          returnNo: `TEMP-${Date.now()}-${supId}`,
          supplierId: supId,
          createdById: validCreatedById,
          terms: receivingReports[0]?.terms || 'N/A',
          reason: cleanReason,
          remarks: typeof remarks === 'string' && remarks.trim() ? remarks.trim().slice(0, 1000) : null,
          items: { create: lineItems.map(({ productName, ...line }) => line) },
        },
      });

      const returnNo = generatePrNumber(created.id, created.createdAt);

      // One stock movement per product, even when the same product was pulled from more than one
      // receiving report in this return — keeps each PURCHASE_RETURN ledger row's amount (attached by
      // models/StockMovement.js from this document's line subtotals) matching exactly one row instead
      // of every row for that product sharing one summed value.
      const totalsByProduct = new Map();
      for (const item of lineItems) {
        totalsByProduct.set(item.productId, (totalsByProduct.get(item.productId) || 0) + item.quantity);
      }
      for (const [productId, quantity] of totalsByProduct) {
        const productName = lineItems.find((l) => l.productId === productId).productName;
        try {
          await changeStock(tx, {
            productId,
            delta: -quantity,
            type: 'PURCHASE_RETURN',
            reason: `Returned to supplier: ${cleanReason}`,
            referenceType: 'PurchaseReturn',
            referenceId: created.id,
            referenceNo: returnNo,
            userId: validCreatedById,
          });
        } catch (error) {
          if (error instanceof StockError && error.code === 'INSUFFICIENT_STOCK') {
            throw new PurchasingError(409, `Cannot return ${quantity} of "${productName}" — not enough currently in stock`);
          }
          throw error;
        }
      }

      return tx.purchaseReturn.update({
        where: { id: created.id },
        data: { returnNo },
        include: returnInclude,
      });
    });
  },

  findById: async (id) => {
    return prisma.purchaseReturn.findUnique({
      where: { id: parseInt(id) },
      include: returnInclude,
    });
  },

  findAll: async () => {
    return prisma.purchaseReturn.findMany({
      include: returnInclude,
      orderBy: { createdAt: 'desc' },
    });
  },
};

module.exports = { PurchaseReturnModel };
