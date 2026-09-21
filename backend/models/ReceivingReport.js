const { prisma } = require('./Product');
const { VAT_RATE, PurchasingError } = require('./PurchaseOrder');
const { changeStock } = require('./stockLedger');

const MAX_UNIT_COST = 10000000;

// RR-YYYYMMDD-#### — date-stamped, uniqueness guaranteed by the row's own id
const generateRrNumber = (id, date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `RR-${y}${m}${d}-${String(id).padStart(4, '0')}`;
};

const reportInclude = {
  supplier: true,
  purchaseOrder: true,
  receivedBy: { select: { username: true } },
  items: { include: { product: true } },
};

// Adds returnedQuantity / returnableQuantity to each receiving report item so the return
// screen can cap what's left to send back across every earlier purchase return.
const withReturnableQuantities = async (reports) => {
  if (reports.length === 0) return reports;
  const returns = await prisma.purchaseReturn.findMany({
    where: { receivingReportId: { in: reports.map((r) => r.id) } },
    select: { receivingReportId: true, items: { select: { productId: true, quantity: true } } },
  });

  const returned = new Map();
  for (const pr of returns) {
    for (const it of pr.items) {
      const key = `${pr.receivingReportId}:${it.productId}`;
      returned.set(key, (returned.get(key) || 0) + it.quantity);
    }
  }

  return reports.map((report) => ({
    ...report,
    items: report.items.map((item) => {
      const returnedQuantity = returned.get(`${report.id}:${item.productId}`) || 0;
      return { ...item, returnedQuantity, returnableQuantity: Math.max(item.quantity - returnedQuantity, 0) };
    }),
  }));
};

const ReceivingReportModel = {
  // File a Receiving Report against a Purchase Order: records what was actually received,
  // tops up product stock/cost, and closes out the source PO.
  create: async ({ purchaseOrderId, items, deliveryNote, invoiceNo, remarks, receivedById }) => {
    const poId = parseInt(purchaseOrderId, 10);
    if (!poId) throw new PurchasingError(400, 'purchaseOrderId is required');
    if (!Array.isArray(items) || items.length === 0) throw new PurchasingError(400, 'At least one received item is required');

    const purchaseOrder = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { items: true },
    });
    if (!purchaseOrder) throw new PurchasingError(404, 'Purchase order not found');
    if (purchaseOrder.status !== 'PENDING') throw new PurchasingError(409, 'This purchase order is not pending receipt');

    // receivedById is set by the route handler from the authenticated user's
    // JWT — verify it still resolves to a real user.
    const validReceivedById = Number(receivedById);
    const userExists = await prisma.user.findUnique({ where: { id: validReceivedById } });
    if (!userExists) throw new Error('Authenticated user no longer exists.');

    // A pending PO's lines never change (only drafts are editable), so they're safe to validate against here.
    const ordered = new Map(purchaseOrder.items.map((it) => [it.productId, it]));
    const seen = new Set();
    const lineItems = items.map((item) => {
      const productId = parseInt(item.productId, 10);
      const quantity = parseInt(item.quantity, 10);
      const unitCostCents = Math.round(Number(item.unitCost) * 100);
      if (!productId || !(quantity > 0) || !Number.isFinite(unitCostCents) || unitCostCents < 0 || unitCostCents > MAX_UNIT_COST * 100) {
        throw new PurchasingError(400, 'Each received item requires a valid productId, quantity, and unitCost');
      }
      if (seen.has(productId)) throw new PurchasingError(400, 'A product can only appear once on a receiving report');
      seen.add(productId);

      const orderedItem = ordered.get(productId);
      if (!orderedItem) throw new PurchasingError(400, `Product ${productId} is not on ${purchaseOrder.poNumber}`);
      if (quantity > orderedItem.quantity) {
        throw new PurchasingError(400, `Cannot receive ${quantity} of product ${productId} — only ${orderedItem.quantity} were ordered on ${purchaseOrder.poNumber}`);
      }
      return {
        productId,
        quantity,
        unitCost: unitCostCents / 100,
        subtotal: (quantity * unitCostCents) / 100,
      };
    });

    return prisma.$transaction(async (tx) => {
      // A filed Receiving Report always closes out its source PO (no partial/back-order tracking).
      // The status-guarded update also serialises two people receiving the same PO at once.
      const closed = await tx.purchaseOrder.updateMany({
        where: { id: purchaseOrder.id, status: 'PENDING' },
        data: { status: 'RECEIVED' },
      });
      if (closed.count === 0) throw new PurchasingError(409, 'This purchase order is not pending receipt');

      const created = await tx.receivingReport.create({
        data: {
          rrNumber: `TEMP-${Date.now()}-${purchaseOrder.id}`,
          purchaseOrderId: purchaseOrder.id,
          supplierId: purchaseOrder.supplierId,
          receivedById: validReceivedById,
          terms: purchaseOrder.terms,
          deliveryNote: typeof deliveryNote === 'string' && deliveryNote.trim() ? deliveryNote.trim().slice(0, 100) : null,
          invoiceNo: typeof invoiceNo === 'string' && invoiceNo.trim() ? invoiceNo.trim().slice(0, 100) : null,
          remarks: typeof remarks === 'string' && remarks.trim() ? remarks.trim().slice(0, 1000) : null,
          items: { create: lineItems },
        },
      });

      const rrNumber = generateRrNumber(created.id, created.receivedAt);

      // Received goods land in stock (logged in the ledger) at their actual received cost
      for (const item of lineItems) {
        await changeStock(tx, {
          productId: item.productId,
          delta: item.quantity,
          type: 'PURCHASE_RECEIPT',
          reason: `Received against ${purchaseOrder.poNumber}`,
          referenceType: 'ReceivingReport',
          referenceId: created.id,
          referenceNo: rrNumber,
          userId: validReceivedById,
        });
        await tx.product.update({ where: { id: item.productId }, data: { costPrice: item.unitCost } });
      }

      return tx.receivingReport.update({
        where: { id: created.id },
        data: { rrNumber },
        include: reportInclude,
      });
    });
  },

  findById: async (id) => {
    const report = await prisma.receivingReport.findUnique({
      where: { id: parseInt(id) },
      include: reportInclude,
    });
    if (!report) return null;
    const [withQuantities] = await withReturnableQuantities([report]);
    return withQuantities;
  },

  // All Receiving Reports, for the "Create Purchase Return" picker
  findAll: async () => {
    const reports = await prisma.receivingReport.findMany({
      include: {
        supplier: true,
        items: { include: { product: true } },
      },
      orderBy: { receivedAt: 'desc' },
    });
    return withReturnableQuantities(reports);
  },
};

module.exports = { ReceivingReportModel, VAT_RATE };
