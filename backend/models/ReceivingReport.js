const { prisma } = require('./Product');
const { VAT_RATE, PurchasingError } = require('./PurchaseOrder');
const { changeStock } = require('./stockLedger');

const MAX_UNIT_COST = 10000000;

// Same fallback the "Add Product" form uses when a barcode isn't given.
const generateBarcode = () => String(Math.floor(1000000000 + Math.random() * 9000000000));

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
  const returnedLines = await prisma.purchaseReturnItem.findMany({
    where: { receivingReportId: { in: reports.map((r) => r.id) } },
    select: { receivingReportId: true, productId: true, quantity: true },
  });

  const returned = new Map();
  for (const line of returnedLines) {
    const key = `${line.receivingReportId}:${line.productId}`;
    returned.set(key, (returned.get(key) || 0) + line.quantity);
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
    // A line is either `productId` (a product on the PO, or an "extra" one that isn't) or `newProduct`
    // (a brand-new product, created when the report is filed). Only PO-matched lines are capped by
    // what was ordered — extras and new products aren't, since they were never on the PO to begin with.
    const ordered = new Map(purchaseOrder.items.map((it) => [it.productId, it]));
    const seen = new Set();
    const parsedLines = items.map((item) => {
      const quantity = parseInt(item.quantity, 10);
      const unitCostCents = Math.round(Number(item.unitCost) * 100);
      if (!(quantity > 0) || !Number.isFinite(unitCostCents) || unitCostCents < 0 || unitCostCents > MAX_UNIT_COST * 100) {
        throw new PurchasingError(400, 'Each received item requires a valid quantity and unitCost');
      }

      if (item.newProduct) {
        const name = typeof item.newProduct.name === 'string' ? item.newProduct.name.trim() : '';
        const priceCents = Math.round(Number(item.newProduct.price) * 100);
        if (!name) throw new PurchasingError(400, 'A new product needs a name');
        if (!Number.isFinite(priceCents) || priceCents <= 0) throw new PurchasingError(400, `"${name}" needs a valid selling price`);
        return { productId: null, newProductName: name, newProductPriceCents: priceCents, quantity, unitCostCents };
      }

      const productId = parseInt(item.productId, 10);
      if (!productId) throw new PurchasingError(400, 'Each received item requires a valid productId, quantity, and unitCost');
      if (seen.has(productId)) throw new PurchasingError(400, 'A product can only appear once on a receiving report');
      seen.add(productId);

      const orderedItem = ordered.get(productId);
      if (orderedItem && quantity > orderedItem.quantity) {
        throw new PurchasingError(400, `Cannot receive ${quantity} of product ${productId} — only ${orderedItem.quantity} were ordered on ${purchaseOrder.poNumber}`);
      }
      return { productId, newProductName: null, quantity, unitCostCents };
    });

    // Extra items (a productId not on the PO) must reference a product that still exists.
    const extraIds = parsedLines.filter((l) => l.productId && !ordered.has(l.productId)).map((l) => l.productId);
    if (extraIds.length) {
      const found = await prisma.product.findMany({ where: { id: { in: extraIds } }, select: { id: true } });
      if (found.length !== new Set(extraIds).size) {
        throw new PurchasingError(400, 'One or more extra items reference a product that no longer exists');
      }
    }

    return prisma.$transaction(async (tx) => {
      // A filed Receiving Report always closes out its source PO (no partial/back-order tracking).
      // The status-guarded update also serialises two people receiving the same PO at once.
      const closed = await tx.purchaseOrder.updateMany({
        where: { id: purchaseOrder.id, status: 'PENDING' },
        data: { status: 'RECEIVED' },
      });
      if (closed.count === 0) throw new PurchasingError(409, 'This purchase order is not pending receipt');

      // Brand-new products are created first so every line has a real productId before the report is written.
      // Category/unit/min stock are left at the schema defaults; the barcode falls back the same way the
      // "Add Product" form does. The product is attached to this PO's supplier, since that's who delivered it.
      const lineItems = [];
      for (const line of parsedLines) {
        let productId = line.productId;
        if (line.newProductName) {
          const newProduct = await tx.product.create({
            data: {
              name: line.newProductName,
              price: line.newProductPriceCents / 100,
              costPrice: line.unitCostCents / 100,
              barcode: generateBarcode(),
              supplierId: purchaseOrder.supplierId,
            },
          });
          productId = newProduct.id;
        }
        lineItems.push({
          productId,
          quantity: line.quantity,
          unitCost: line.unitCostCents / 100,
          subtotal: (line.quantity * line.unitCostCents) / 100,
        });
      }

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

  // All Receiving Reports, optionally scoped to one supplier — for the "Create Purchase
  // Return" picker, which starts from a supplier and shows every batch they've delivered.
  findAll: async ({ supplierId } = {}) => {
    const where = {};
    const sid = parseInt(supplierId, 10);
    if (sid) where.supplierId = sid;
    const reports = await prisma.receivingReport.findMany({
      where,
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
