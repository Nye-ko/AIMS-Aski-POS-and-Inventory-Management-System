const { prisma } = require('./Product');
const { PurchasingError } = require('./PurchaseOrder');

// PR-YYYYMMDD-#### — date-stamped, uniqueness guaranteed by the row's own id
const generatePrNumber = (id, date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `PR-${y}${m}${d}-${String(id).padStart(4, '0')}`;
};

const returnInclude = {
  supplier: true,
  receivingReport: true,
  createdBy: { select: { username: true } },
  items: { include: { product: true } },
};

const PurchaseReturnModel = {
  // File a Purchase Return against a Receiving Report: records what's being sent back
  // and decrements product stock by the returned quantity (cost price is left untouched).
  // Returns are capped at what was received minus everything already returned on that report.
  create: async ({ receivingReportId, items, reason, remarks, createdById }) => {
    const rrId = parseInt(receivingReportId, 10);
    if (!rrId) throw new PurchasingError(400, 'receivingReportId is required');
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
      const productId = parseInt(item.productId, 10);
      const quantity = parseInt(item.quantity, 10);
      if (!productId || !(quantity > 0)) {
        throw new PurchasingError(400, 'Each returned item requires a valid productId and quantity');
      }
      if (seen.has(productId)) throw new PurchasingError(400, 'A product can only appear once on a purchase return');
      seen.add(productId);
      return { productId, quantity };
    });

    return prisma.$transaction(async (tx) => {
      // Lock the receiving report so concurrent returns against it are checked one at a time.
      const locked = await tx.$queryRaw`SELECT id FROM "ReceivingReport" WHERE id = ${rrId} FOR UPDATE`;
      if (locked.length === 0) throw new PurchasingError(404, 'Receiving report not found');

      const receivingReport = await tx.receivingReport.findUnique({
        where: { id: rrId },
        include: { items: { include: { product: true } } },
      });
      const priorReturns = await tx.purchaseReturnItem.groupBy({
        by: ['productId'],
        where: { purchaseReturn: { receivingReportId: rrId } },
        _sum: { quantity: true },
      });
      const alreadyReturned = new Map(priorReturns.map((r) => [r.productId, r._sum.quantity || 0]));

      const lineItems = requested.map(({ productId, quantity }) => {
        const receivedItem = receivingReport.items.find((ri) => ri.productId === productId);
        if (!receivedItem) {
          throw new PurchasingError(400, `Product ${productId} was not part of receiving report ${receivingReport.rrNumber}`);
        }
        const returnable = receivedItem.quantity - (alreadyReturned.get(productId) || 0);
        if (quantity > returnable) {
          throw new PurchasingError(
            409,
            `Cannot return ${quantity} of "${receivedItem.product.name}" — only ${Math.max(returnable, 0)} of the ${receivedItem.quantity} received on ${receivingReport.rrNumber} can still be returned`,
          );
        }

        const unitCostCents = Math.round(Number(receivedItem.unitCost) * 100);
        return {
          productId,
          quantity,
          unitCost: unitCostCents / 100,
          subtotal: (quantity * unitCostCents) / 100,
          productName: receivedItem.product.name,
        };
      });

      // Guarded decrement: never let a return push stock below zero, even if sales happen meanwhile.
      for (const item of lineItems) {
        const { count } = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (count === 0) {
          throw new PurchasingError(409, `Cannot return ${item.quantity} of "${item.productName}" — not enough currently in stock`);
        }
      }

      const created = await tx.purchaseReturn.create({
        data: {
          returnNo: `TEMP-${Date.now()}-${rrId}`,
          receivingReportId: receivingReport.id,
          supplierId: receivingReport.supplierId,
          createdById: validCreatedById,
          terms: receivingReport.terms,
          reason: cleanReason,
          remarks: typeof remarks === 'string' && remarks.trim() ? remarks.trim().slice(0, 1000) : null,
          items: { create: lineItems.map(({ productName, ...line }) => line) },
        },
      });

      return tx.purchaseReturn.update({
        where: { id: created.id },
        data: { returnNo: generatePrNumber(created.id, created.createdAt) },
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
