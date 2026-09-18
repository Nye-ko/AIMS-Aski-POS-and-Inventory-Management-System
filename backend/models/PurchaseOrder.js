const { prisma } = require('./Product');

const VAT_RATE = 0.12;

// PO-YYYYMMDD-#### — date-stamped, uniqueness guaranteed by the row's own id
const generatePoNumber = (id, date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `PO-${y}${m}${d}-${String(id).padStart(4, '0')}`;
};

const PurchaseOrderModel = {
  // Create a Purchase Order for a single supplier from the checked low-stock items
  create: async ({ supplierId, items, terms, remarks, preparedBy, createdById }) => {
    if (!supplierId) throw new Error('supplierId is required');
    if (!Array.isArray(items) || items.length === 0) throw new Error('At least one item is required');

    // createdById is set by the route handler from the authenticated user's
    // JWT — verify it still resolves to a real user.
    const validCreatedById = Number(createdById);
    const userExists = await prisma.user.findUnique({ where: { id: validCreatedById } });
    if (!userExists) throw new Error('Authenticated user no longer exists.');

    const lineItems = items.map((item) => {
      const quantity = parseInt(item.quantity, 10);
      const unitCost = parseFloat(item.unitCost);
      if (!item.productId || !quantity || quantity <= 0 || isNaN(unitCost)) {
        throw new Error('Each item requires a valid productId, quantity, and unitCost');
      }
      return {
        productId: Number(item.productId),
        quantity,
        unitCost,
        subtotal: Number((quantity * unitCost).toFixed(2)),
      };
    });

    const totalPrice = lineItems.reduce((sum, i) => sum + i.subtotal, 0);
    const totalVat = Number((totalPrice * VAT_RATE).toFixed(2));
    const totalAmount = Number((totalPrice + totalVat).toFixed(2));

    // Create with a placeholder number first so we can stamp the final one using the generated id
    const created = await prisma.purchaseOrder.create({
      data: {
        poNumber: `TEMP-${Date.now()}`,
        supplierId: Number(supplierId),
        createdById: validCreatedById,
        terms: terms || 'N/A',
        remarks: remarks || null,
        preparedBy: preparedBy || null,
        totalAmount,
        items: { create: lineItems },
      },
    });

    return prisma.purchaseOrder.update({
      where: { id: created.id },
      data: { poNumber: generatePoNumber(created.id, created.createdAt) },
      include: {
        supplier: true,
        createdBy: { select: { username: true } },
        items: { include: { product: true } },
      },
    });
  },

  findById: async (id) => {
    return prisma.purchaseOrder.findUnique({
      where: { id: parseInt(id) },
      include: {
        supplier: true,
        createdBy: { select: { username: true } },
        items: { include: { product: true } },
      },
    });
  },

  // Purchase Orders awaiting a Receiving Report, for the "Create Receiving Report" picker
  findPending: async () => {
    return prisma.purchaseOrder.findMany({
      where: { status: 'PENDING' },
      include: {
        supplier: true,
        items: { include: { product: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },
};

module.exports = { PurchaseOrderModel, VAT_RATE };
