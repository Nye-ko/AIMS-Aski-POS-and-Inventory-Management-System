const { prisma } = require('./Product');
const { cleanSupplierName, findSupplierByName } = require('../services/supplierName');

const VAT_RATE = 0.12;
const TAGGING_OPTIONS = ['Regular', 'Urgent', 'Rush', 'Special Order'];
const MAX_TOTAL_CENTS = 9999999999; // Decimal(10,2) ceiling
const MAX_LINE_QUANTITY = 1000000;

class PurchasingError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// PO-YYYYMMDD-#### — date-stamped, uniqueness guaranteed by the row's own id
const generatePoNumber = (id, date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `PO-${y}${m}${d}-${String(id).padStart(4, '0')}`;
};

const toCents = (value) => Math.round(Number(value) * 100);

const cleanText = (value, max) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

const orderInclude = {
  supplier: true,
  createdBy: { select: { username: true } },
  items: { include: { product: true } },
};

// Validates the client payload and recomputes every money figure server-side in integer
// centavos: net = (line subtotals + 12% VAT) - discount.
// The supplier is either an existing one (`supplierId`) or a name typed on the form (`supplierName`), which
// is matched to an existing supplier or created when the order is saved (see resolveSupplierId).
const normalizeOrderInput = async ({ supplierId, supplierName, items, terms, remarks, discount, shipTo, shippingAddress, purpose, tagging }) => {
  let supplierRef;
  const validSupplierId = parseInt(supplierId, 10);
  if (validSupplierId) {
    const supplier = await prisma.supplier.findUnique({ where: { id: validSupplierId }, select: { id: true } });
    if (!supplier) throw new PurchasingError(400, 'Supplier not found');
    supplierRef = { id: validSupplierId };
  } else {
    const name = cleanSupplierName(supplierName);
    if (!name) throw new PurchasingError(400, 'A supplier is required');
    supplierRef = { name };
  }

  if (!Array.isArray(items) || items.length === 0) throw new PurchasingError(400, 'At least one item is required');

  const seen = new Set();
  const lineItems = items.map((item) => {
    const productId = parseInt(item.productId, 10);
    const quantity = parseInt(item.quantity, 10);
    const unitCostCents = toCents(item.unitCost);
    if (!productId || !(quantity > 0) || quantity > MAX_LINE_QUANTITY || !Number.isFinite(unitCostCents) || unitCostCents < 0) {
      throw new PurchasingError(400, 'Each item requires a valid productId, quantity, and unitCost');
    }
    if (seen.has(productId)) throw new PurchasingError(400, 'A product can only appear once on a purchase order');
    seen.add(productId);
    return { productId, quantity, unitCostCents, subtotalCents: quantity * unitCostCents };
  });

  const products = await prisma.product.findMany({ where: { id: { in: [...seen] } }, select: { id: true } });
  if (products.length !== seen.size) throw new PurchasingError(400, 'One or more products no longer exist');

  const subtotalCents = lineItems.reduce((sum, li) => sum + li.subtotalCents, 0);
  const vatCents = Math.round(subtotalCents * VAT_RATE);
  const grossCents = subtotalCents + vatCents;
  const discountCents = discount === undefined || discount === null || discount === '' ? 0 : toCents(discount);
  if (!Number.isFinite(discountCents) || discountCents < 0) throw new PurchasingError(400, 'Discount must be zero or more');
  if (discountCents > grossCents) throw new PurchasingError(400, 'Discount cannot exceed the order total');
  if (grossCents > MAX_TOTAL_CENTS) throw new PurchasingError(400, 'Order total is too large');

  const taggingValue = tagging === undefined || tagging === null || tagging === '' ? 'Regular' : tagging;
  if (!TAGGING_OPTIONS.includes(taggingValue)) throw new PurchasingError(400, 'Invalid tagging');

  return {
    supplierRef,
    header: {
      terms: cleanText(terms, 100) || 'N/A',
      remarks: cleanText(remarks, 1000),
      shipTo: cleanText(shipTo, 255),
      shippingAddress: cleanText(shippingAddress, 255),
      purpose: cleanText(purpose, 255),
      tagging: taggingValue,
      discount: discountCents / 100,
      totalAmount: (grossCents - discountCents) / 100,
    },
    lineItems: lineItems.map((li) => ({
      productId: li.productId,
      quantity: li.quantity,
      unitCost: li.unitCostCents / 100,
      subtotal: li.subtotalCents / 100,
    })),
  };
};

// Inside the order's transaction, so a failed order never leaves a stray new supplier behind.
const resolveSupplierId = async (tx, supplierRef) => {
  if (supplierRef.id) return supplierRef.id;
  const existing = findSupplierByName(await tx.supplier.findMany({ select: { id: true, name: true } }), supplierRef.name);
  if (existing) return existing.id;
  const created = await tx.supplier.create({ data: { name: supplierRef.name }, select: { id: true } });
  return created.id;
};

const describeStatus = (status) =>
  ({ DRAFT: 'still a draft', PENDING: 'pending', RECEIVED: 'already received', CANCELLED: 'cancelled' })[status] || status;

const PurchaseOrderModel = {
  // Create a Purchase Order as either a DRAFT (editable, not receivable) or PENDING (submitted).
  create: async ({ status = 'PENDING', preparedBy, createdById, ...input }) => {
    if (!['DRAFT', 'PENDING'].includes(status)) throw new PurchasingError(400, 'Invalid status');
    const { header, supplierRef, lineItems } = await normalizeOrderInput(input);

    // createdById is set by the route handler from the authenticated user's
    // JWT — verify it still resolves to a real user.
    const validCreatedById = Number(createdById);
    const userExists = await prisma.user.findUnique({ where: { id: validCreatedById } });
    if (!userExists) throw new Error('Authenticated user no longer exists.');

    return prisma.$transaction(async (tx) => {
      const supplierId = await resolveSupplierId(tx, supplierRef);
      // Create with a placeholder number first so we can stamp the final one using the generated id
      const created = await tx.purchaseOrder.create({
        data: {
          ...header,
          supplierId,
          poNumber: `TEMP-${Date.now()}-${validCreatedById}`,
          status,
          preparedBy: cleanText(preparedBy, 100),
          createdById: validCreatedById,
          items: { create: lineItems },
        },
      });

      return tx.purchaseOrder.update({
        where: { id: created.id },
        data: { poNumber: generatePoNumber(created.id, created.createdAt) },
        include: orderInclude,
      });
    });
  },

  // Replace the header and items of a DRAFT. Submitted orders are immutable.
  updateDraft: async (id, input) => {
    const poId = parseInt(id, 10);
    const { header, supplierRef, lineItems } = await normalizeOrderInput(input);

    return prisma.$transaction(async (tx) => {
      const supplierId = await resolveSupplierId(tx, supplierRef);
      const { count } = await tx.purchaseOrder.updateMany({ where: { id: poId, status: 'DRAFT' }, data: { ...header, supplierId } });
      if (count === 0) {
        const existing = await tx.purchaseOrder.findUnique({ where: { id: poId }, select: { status: true } });
        if (!existing) throw new PurchasingError(404, 'Purchase order not found');
        throw new PurchasingError(409, `Only drafts can be edited — this purchase order is ${describeStatus(existing.status)}.`);
      }
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: poId } });
      await tx.purchaseOrderItem.createMany({ data: lineItems.map((li) => ({ ...li, purchaseOrderId: poId })) });
      return tx.purchaseOrder.findUnique({ where: { id: poId }, include: orderInclude });
    });
  },

  // DRAFT -> PENDING: the order becomes receivable.
  submit: async (id) => {
    const poId = parseInt(id, 10);
    const { count } = await prisma.purchaseOrder.updateMany({
      where: { id: poId, status: 'DRAFT' },
      data: { status: 'PENDING' },
    });
    if (count === 0) {
      const existing = await prisma.purchaseOrder.findUnique({ where: { id: poId }, select: { status: true } });
      if (!existing) throw new PurchasingError(404, 'Purchase order not found');
      throw new PurchasingError(409, `Only drafts can be submitted — this purchase order is ${describeStatus(existing.status)}.`);
    }
    return prisma.purchaseOrder.findUnique({ where: { id: poId }, include: orderInclude });
  },

  // DRAFT/PENDING -> CANCELLED. Guarded on status so it can't race a receiving report.
  cancel: async (id) => {
    const poId = parseInt(id, 10);
    const { count } = await prisma.purchaseOrder.updateMany({
      where: { id: poId, status: { in: ['DRAFT', 'PENDING'] } },
      data: { status: 'CANCELLED' },
    });
    if (count === 0) {
      const existing = await prisma.purchaseOrder.findUnique({ where: { id: poId }, select: { status: true } });
      if (!existing) throw new PurchasingError(404, 'Purchase order not found');
      throw new PurchasingError(409, `This purchase order is ${describeStatus(existing.status)} and cannot be cancelled.`);
    }
    return prisma.purchaseOrder.findUnique({ where: { id: poId }, include: orderInclude });
  },

  findById: async (id) => {
    return prisma.purchaseOrder.findUnique({
      where: { id: parseInt(id) },
      include: orderInclude,
    });
  },

  // All Purchase Orders (any status), for the "Purchase Orders" browse window
  findAll: async (search) => {
    return prisma.purchaseOrder.findMany({
      where: search ? { poNumber: { contains: search, mode: 'insensitive' } } : undefined,
      include: {
        supplier: true,
        items: { include: { product: true } },
        receivingReport: { select: { id: true, rrNumber: true, receivedAt: true } },
      },
      orderBy: { createdAt: 'desc' },
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

  // Only unsent (DRAFT) or CANCELLED orders may be deleted; a submitted order is cancelled instead
  // so its PO number stays on record.
  delete: async (id) => {
    const purchaseOrder = await prisma.purchaseOrder.findUnique({
      where: { id: parseInt(id) },
      select: { status: true },
    });
    if (!purchaseOrder) throw new PurchasingError(404, 'Purchase order not found');
    if (!['DRAFT', 'CANCELLED'].includes(purchaseOrder.status)) {
      throw new PurchasingError(409, `A ${purchaseOrder.status.toLowerCase()} purchase order cannot be deleted — cancel it instead.`);
    }
    const { count } = await prisma.purchaseOrder.deleteMany({
      where: { id: parseInt(id), status: { in: ['DRAFT', 'CANCELLED'] } },
    });
    if (count === 0) throw new PurchasingError(409, 'This purchase order changed status and cannot be deleted.');
  },
};

module.exports = { PurchaseOrderModel, PurchasingError, VAT_RATE };
