const { prisma } = require('./Product');
const { VAT_RATE } = require('./PurchaseOrder');

// RR-YYYYMMDD-#### — date-stamped, uniqueness guaranteed by the row's own id
const generateRrNumber = (id, date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `RR-${y}${m}${d}-${String(id).padStart(4, '0')}`;
};

const ReceivingReportModel = {
  // File a Receiving Report against a Purchase Order: records what was actually received,
  // tops up product stock/cost, and closes out the source PO.
  create: async ({ purchaseOrderId, items, deliveryNote, invoiceNo, remarks, receivedById }) => {
    if (!purchaseOrderId) throw new Error('purchaseOrderId is required');
    if (!Array.isArray(items) || items.length === 0) throw new Error('At least one received item is required');

    const purchaseOrder = await prisma.purchaseOrder.findUnique({ where: { id: Number(purchaseOrderId) } });
    if (!purchaseOrder) throw new Error('Purchase order not found');
    if (purchaseOrder.status !== 'PENDING') throw new Error('This purchase order is not pending receipt');

    let validReceivedById = Number(receivedById) || 5;
    const userExists = await prisma.user.findUnique({ where: { id: validReceivedById } });
    if (!userExists) {
      const fallbackUser = await prisma.user.findFirst();
      if (!fallbackUser) throw new Error('No user found in the database to attribute this receiving report to.');
      validReceivedById = fallbackUser.id;
    }

    const lineItems = items.map((item) => {
      const quantity = parseInt(item.quantity, 10);
      const unitCost = parseFloat(item.unitCost);
      if (!item.productId || !quantity || quantity <= 0 || isNaN(unitCost)) {
        throw new Error('Each received item requires a valid productId, quantity, and unitCost');
      }
      return {
        productId: Number(item.productId),
        quantity,
        unitCost,
        subtotal: Number((quantity * unitCost).toFixed(2)),
      };
    });

    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.receivingReport.create({
        data: {
          rrNumber: `TEMP-${Date.now()}`,
          purchaseOrderId: purchaseOrder.id,
          supplierId: purchaseOrder.supplierId,
          receivedById: validReceivedById,
          terms: purchaseOrder.terms,
          deliveryNote: deliveryNote || null,
          invoiceNo: invoiceNo || null,
          remarks: remarks || null,
          items: { create: lineItems },
        },
      });

      // Received goods land in stock at their actual received cost
      for (const item of lineItems) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stock: { increment: item.quantity },
            costPrice: item.unitCost,
          },
        });
      }

      // A filed Receiving Report always closes out its source PO (no partial/back-order tracking)
      await tx.purchaseOrder.update({
        where: { id: purchaseOrder.id },
        data: { status: 'RECEIVED' },
      });

      return tx.receivingReport.update({
        where: { id: created.id },
        data: { rrNumber: generateRrNumber(created.id, created.receivedAt) },
        include: {
          supplier: true,
          purchaseOrder: true,
          receivedBy: { select: { username: true } },
          items: { include: { product: true } },
        },
      });
    });

    return result;
  },

  findById: async (id) => {
    return prisma.receivingReport.findUnique({
      where: { id: parseInt(id) },
      include: {
        supplier: true,
        purchaseOrder: true,
        receivedBy: { select: { username: true } },
        items: { include: { product: true } },
      },
    });
  },

  // All Receiving Reports, for the "Create Purchase Return" picker
  findAll: async () => {
    return prisma.receivingReport.findMany({
      include: {
        supplier: true,
        items: { include: { product: true } },
      },
      orderBy: { receivedAt: 'desc' },
    });
  },
};

module.exports = { ReceivingReportModel, VAT_RATE };
