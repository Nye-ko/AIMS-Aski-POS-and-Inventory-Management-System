const { prisma } = require('./Product');

// PR-YYYYMMDD-#### — date-stamped, uniqueness guaranteed by the row's own id
const generatePrNumber = (id, date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `PR-${y}${m}${d}-${String(id).padStart(4, '0')}`;
};

const PurchaseReturnModel = {
  // File a Purchase Return against a Receiving Report: records what's being sent back
  // and decrements product stock by the returned quantity (cost price is left untouched).
  create: async ({ receivingReportId, items, reason, remarks, createdById }) => {
    if (!receivingReportId) throw new Error('receivingReportId is required');
    if (!Array.isArray(items) || items.length === 0) throw new Error('At least one returned item is required');
    if (!reason) throw new Error('A reason for the return is required');

    const receivingReport = await prisma.receivingReport.findUnique({
      where: { id: Number(receivingReportId) },
      include: { items: { include: { product: true } } },
    });
    if (!receivingReport) throw new Error('Receiving report not found');

    let validCreatedById = Number(createdById) || 5;
    const userExists = await prisma.user.findUnique({ where: { id: validCreatedById } });
    if (!userExists) {
      const fallbackUser = await prisma.user.findFirst();
      if (!fallbackUser) throw new Error('No user found in the database to attribute this purchase return to.');
      validCreatedById = fallbackUser.id;
    }

    const lineItems = items.map((item) => {
      const quantity = parseInt(item.quantity, 10);
      if (!item.productId || !quantity || quantity <= 0) {
        throw new Error('Each returned item requires a valid productId and quantity');
      }

      const receivedItem = receivingReport.items.find((ri) => ri.productId === Number(item.productId));
      if (!receivedItem) {
        throw new Error(`Product ${item.productId} was not part of receiving report ${receivingReport.rrNumber}`);
      }
      if (quantity > receivedItem.quantity) {
        throw new Error(`Cannot return ${quantity} of "${receivedItem.product.name}" — only ${receivedItem.quantity} were received on this report`);
      }
      if (quantity > receivedItem.product.stock) {
        throw new Error(`Cannot return ${quantity} of "${receivedItem.product.name}" — only ${receivedItem.product.stock} currently in stock`);
      }

      const unitCost = Number(receivedItem.unitCost);
      return {
        productId: Number(item.productId),
        quantity,
        unitCost,
        subtotal: Number((quantity * unitCost).toFixed(2)),
      };
    });

    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.purchaseReturn.create({
        data: {
          returnNo: `TEMP-${Date.now()}`,
          receivingReportId: receivingReport.id,
          supplierId: receivingReport.supplierId,
          createdById: validCreatedById,
          terms: receivingReport.terms,
          reason,
          remarks: remarks || null,
          items: { create: lineItems },
        },
      });

      for (const item of lineItems) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
      }

      return tx.purchaseReturn.update({
        where: { id: created.id },
        data: { returnNo: generatePrNumber(created.id, created.createdAt) },
        include: {
          supplier: true,
          receivingReport: true,
          createdBy: { select: { username: true } },
          items: { include: { product: true } },
        },
      });
    });

    return result;
  },

  findById: async (id) => {
    return prisma.purchaseReturn.findUnique({
      where: { id: parseInt(id) },
      include: {
        supplier: true,
        receivingReport: true,
        createdBy: { select: { username: true } },
        items: { include: { product: true } },
      },
    });
  },
};

module.exports = { PurchaseReturnModel };
