// models/Product.js
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const { changeStock, STOCK_IN_TYPES } = require('./stockLedger');
const { createBatch, consumeFIFO } = require('./stockBatches');

class ProductError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MAX_PRICE = 99999999.99;
const MAX_COUNT = 100000000;
const ADJUSTMENT_REASONS = ['Damaged', 'Expired', 'Lost / Theft', 'Count correction', 'Other'];

const parseMoney = (value, label) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX_PRICE) throw new ProductError(400, `${label} must be a valid amount of zero or more.`);
  return Math.round(n * 100) / 100;
};

const parseCount = (value, label) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_COUNT) throw new ProductError(400, `${label} must be a whole number of zero or more.`);
  return n;
};

const cleanCode = (value, label, max = 64) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (trimmed.length > max) throw new ProductError(400, `${label} is too long.`);
  return trimmed || null;
};

const parseExpiry = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ProductError(400, 'Expiry date is not a valid date.');
  return d;
};

const assertSupplierExists = async (supplierId) => {
  if (supplierId === null || supplierId === undefined) return;
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true } });
  if (!supplier) throw new ProductError(400, 'Supplier not found.');
};

// Barcode and SKU are unique; report a clash as 409 instead of a generic server error.
const assertCodesAvailable = async ({ barcode, sku }, excludeId) => {
  const notSelf = excludeId ? { id: { not: excludeId } } : {};
  if (barcode) {
    const clash = await prisma.product.findFirst({ where: { barcode, ...notSelf }, select: { name: true } });
    if (clash) throw new ProductError(409, `Barcode ${barcode} is already used by "${clash.name}".`);
  }
  if (sku) {
    const clash = await prisma.product.findFirst({ where: { sku, ...notSelf }, select: { name: true } });
    if (clash) throw new ProductError(409, `SKU ${sku} is already used by "${clash.name}".`);
  }
};

// Backstop for the race between the pre-check above and the insert/update.
const rethrowUniqueViolation = (error) => {
  if (error && error.code === 'P2002') {
    throw new ProductError(409, 'That barcode or SKU is already in use by another product.');
  }
  throw error;
};

const toDateKey = (date) => new Date(date).toISOString().slice(0, 10);

// Shared formatter so every route returns the same product shape the frontend expects
// (unitCost/sellingPrice/supplierName/status), not the raw Prisma record.
// batchDate is derived: the last time stock arrived (opening balance, manual add, or receiving report).
const formatProduct = (p, batchDate) => {
  const now = new Date();
  let status = 'In Stock';
  if (p.expiryDate && new Date(p.expiryDate) < now) {
    status = 'Expired';
  } else if (p.stock <= p.minStock) {
    status = 'Low Stock';
  }

  return {
    id: p.id,
    name: p.name,
    barcode: p.barcode,
    sku: p.sku,
    category: p.category,
    unit: p.unit,
    stock: p.stock,
    minStock: p.minStock,
    unitCost: Number(p.costPrice),
    // Provide both keys so both new (`sellingPrice`) and legacy (`price`)
    // consumers work without a frontend change.
    price: Number(p.price),
    sellingPrice: Number(p.price),
    expiryDate: p.expiryDate,
    createdAt: p.createdAt,
    supplierId: p.supplierId,
    supplierName: p.supplier ? p.supplier.name : 'N/A',
    batchDate: toDateKey(batchDate || p.createdAt),
    status,
  };
};

const latestStockInDate = async (client, productId) => {
  const last = await client.stockMovement.findFirst({
    where: { productId, type: { in: STOCK_IN_TYPES } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return last ? last.createdAt : null;
};

// Shared by findAll/findManyFormatted: attaches each product's batchDate (last stock-in) and
// runs them through formatProduct in one batch instead of one query per product.
const formatMany = async (products) => {
  if (products.length === 0) return [];
  const lastStockIns = await prisma.stockMovement.groupBy({
    by: ['productId'],
    where: { productId: { in: products.map((p) => p.id) }, type: { in: STOCK_IN_TYPES } },
    _max: { createdAt: true },
  });
  const batchByProduct = new Map(lastStockIns.map((r) => [r.productId, r._max.createdAt]));
  return products.map((p) => formatProduct(p, batchByProduct.get(p.id)));
};

const ProductModel = {
  // Fetch all products with supplier details & computed statuses for Inventory List
  findAll: async () => {
    const products = await prisma.product.findMany({
      include: {
        supplier: true,
      },
      orderBy: { id: 'asc' },
    });
    return formatMany(products);
  },

  // Formatted rows for a specific set of product ids, in the same shape as findAll — used to
  // broadcast a `stock_updated` socket event after a sale, receiving report, purchase return, or
  // manual stock change, so the Inventory page can patch/insert rows live without a refetch.
  findManyFormatted: async (ids) => {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const products = await prisma.product.findMany({
      where: { id: { in: [...new Set(ids)] } },
      include: { supplier: true },
    });
    return formatMany(products);
  },

  // Find product by ID
  findById: async (id) => {
    return await prisma.product.findUnique({
      where: { id: parseInt(id) },
      include: { supplier: true },
    });
  },

  // Find product by exact barcode OR matching last 6 digits
  findByBarcode: async (code) => {
    return await prisma.product.findMany({
      where: {
        OR: [
          { barcode: code },
          { barcode: { endsWith: code } },
        ],
      },
    });
  },

  // Create a new product with all inventory fields; any starting stock is logged as an OPENING movement.
  create: async (data, userId) => {
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name || name.length > 255) throw new ProductError(400, 'Product name is required.');

    const barcode = cleanCode(data.barcode, 'Barcode');
    const sku = cleanCode(data.sku, 'SKU');
    const supplierId = data.supplierId ? parseInt(data.supplierId) : null;
    const stock = parseCount(data.currentStock ?? data.stock ?? 0, 'Current stock');
    // Inventory form sends sellingPrice/unitCost; fall back to price/costPrice for other callers
    const price = parseMoney(data.sellingPrice ?? data.price ?? 0, 'Selling price');
    const costPrice = parseMoney(data.unitCost ?? data.costPrice ?? 0, 'Unit cost');
    const minStock = data.minStock === undefined || data.minStock === '' ? 10 : parseCount(data.minStock, 'Minimum stock');
    const expiryDate = parseExpiry(data.expiryDate);

    await assertSupplierExists(supplierId);
    await assertCodesAvailable({ barcode, sku });

    try {
      return await prisma.$transaction(async (tx) => {
        const created = await tx.product.create({
          data: {
            name,
            barcode,
            sku,
            category: (typeof data.category === 'string' && data.category.trim()) || 'Uncategorized',
            unit: (typeof data.unit === 'string' && data.unit.trim()) || 'PC/S',
            price,
            costPrice,
            stock: 0,
            minStock,
            expiryDate,
            supplierId,
          },
        });

        if (stock > 0) {
          await changeStock(tx, {
            productId: created.id,
            delta: stock,
            type: 'OPENING',
            reason: 'Initial stock',
            userId,
          });
          await createBatch(tx, {
            productId: created.id,
            supplierId,
            unitCost: costPrice,
            quantity: stock,
            referenceType: 'Opening',
            referenceNo: 'Initial stock',
          });
        }
        const product = await tx.product.findUnique({ where: { id: created.id }, include: { supplier: true } });
        return formatProduct(product, await latestStockInDate(tx, created.id));
      });
    } catch (error) {
      return rethrowUniqueViolation(error);
    }
  },

  // Add stock to an existing product, optionally recording the supplying vendor.
  addStock: async (id, quantity, supplierId, userId) => {
    const productId = parseInt(id);
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0 || qty > MAX_COUNT) {
      throw new ProductError(400, 'Stock quantity must be a whole number greater than zero.');
    }
    const validSupplierId = supplierId ? parseInt(supplierId) : null;
    await assertSupplierExists(validSupplierId);

    const exists = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, costPrice: true } });
    if (!exists) throw new ProductError(404, 'Product not found.');

    return prisma.$transaction(async (tx) => {
      await changeStock(tx, { productId, delta: qty, type: 'MANUAL_ADD', reason: 'Stock added manually', userId });
      if (validSupplierId) await tx.product.update({ where: { id: productId }, data: { supplierId: validSupplierId } });
      await createBatch(tx, {
        productId,
        supplierId: validSupplierId,
        // No cost is collected on this form, so the batch takes the product's current cost —
        // still keeps FIFO/qty accounting exact even though it can't add real per-delivery cost info.
        unitCost: exists.costPrice,
        quantity: qty,
        referenceType: 'ManualAdd',
        referenceNo: 'Stock added manually',
      });
      const product = await tx.product.findUnique({ where: { id: productId }, include: { supplier: true } });
      return formatProduct(product, await latestStockInDate(tx, productId));
    });
  },

  // Manual correction (damage, expiry, loss, count fix). Either a signed `quantityChange` or the
  // physically `countedQuantity`; the server works out the difference against the live stock.
  adjustStock: async (id, { quantityChange, countedQuantity, reason, notes }, userId) => {
    const productId = parseInt(id);
    if (!ADJUSTMENT_REASONS.includes(reason)) {
      throw new ProductError(400, `Reason must be one of: ${ADJUSTMENT_REASONS.join(', ')}.`);
    }
    const cleanNotes = typeof notes === 'string' ? notes.trim().slice(0, 255) : '';
    if (reason === 'Other' && !cleanNotes) throw new ProductError(400, 'Please describe the reason for "Other".');

    const hasChange = quantityChange !== undefined && quantityChange !== null && quantityChange !== '';
    const hasCount = countedQuantity !== undefined && countedQuantity !== null && countedQuantity !== '';
    if (hasChange === hasCount) throw new ProductError(400, 'Provide either quantityChange or countedQuantity.');

    let requestedChange;
    let requestedCount;
    if (hasChange) {
      requestedChange = Number(quantityChange);
      if (!Number.isInteger(requestedChange) || requestedChange === 0 || Math.abs(requestedChange) > MAX_COUNT) {
        throw new ProductError(400, 'quantityChange must be a non-zero whole number.');
      }
    } else {
      requestedCount = parseCount(countedQuantity, 'Counted quantity');
    }

    return prisma.$transaction(async (tx) => {
      // Lock the row so the delta is computed against the stock we will actually change.
      const locked = await tx.$queryRaw`SELECT stock, "costPrice" FROM "Product" WHERE id = ${productId} FOR UPDATE`;
      if (locked.length === 0) throw new ProductError(404, 'Product not found.');
      const current = locked[0].stock;

      const delta = hasChange ? requestedChange : requestedCount - current;
      if (delta === 0) throw new ProductError(400, 'The counted quantity matches the current stock — nothing to adjust.');
      if (current + delta < 0) throw new ProductError(409, `Cannot remove ${-delta}; only ${current} in stock.`);

      await changeStock(tx, {
        productId,
        delta,
        type: 'ADJUSTMENT',
        reason: cleanNotes ? `${reason}: ${cleanNotes}` : reason,
        userId,
      });

      // Keep batch quantities in sync: a positive adjustment (e.g. a count correction upward)
      // opens a new batch at the product's current cost; a negative one (damage, loss, a
      // downward count fix) consumes the oldest batches first, same as a sale.
      if (delta > 0) {
        await createBatch(tx, {
          productId,
          unitCost: locked[0].costPrice,
          quantity: delta,
          referenceType: 'Adjustment',
          referenceNo: reason,
        });
      } else {
        await consumeFIFO(tx, productId, -delta, locked[0].costPrice);
      }

      const product = await tx.product.findUnique({ where: { id: productId }, include: { supplier: true } });
      return formatProduct(product, await latestStockInDate(tx, productId));
    });
  },

  // Update whitelisted product fields (used by PATCH /api/products/:id to set/edit expiry dates,
  // minStock, prices, etc.). Stock is NOT editable here — it only moves through the ledger
  // (add-stock, adjust-stock, receiving, sales, returns). Returns { before, after } so
  // callers can detect crossings — e.g. an expiryDate entering the warning
  // window — and dispatch alert emails accordingly.
  update: async (id, patch) => {
    const productId = parseInt(id);
    const before = await prisma.product.findUnique({ where: { id: productId } });
    if (!before) return { before: null, after: null };

    const data = {};
    if (patch.name !== undefined) {
      const name = typeof patch.name === 'string' ? patch.name.trim() : '';
      if (!name || name.length > 255) throw new ProductError(400, 'Product name is required.');
      data.name = name;
    }
    if (patch.barcode !== undefined) data.barcode = cleanCode(patch.barcode, 'Barcode');
    if (patch.sku !== undefined) data.sku = cleanCode(patch.sku, 'SKU');
    if (patch.category !== undefined) data.category = patch.category;
    if (patch.price !== undefined) data.price = parseMoney(patch.price, 'Selling price');
    if (patch.costPrice !== undefined) data.costPrice = parseMoney(patch.costPrice, 'Unit cost');
    if (patch.minStock !== undefined) data.minStock = parseCount(patch.minStock, 'Minimum stock');
    if (patch.expiryDate !== undefined) data.expiryDate = parseExpiry(patch.expiryDate);
    if (patch.supplierId !== undefined) {
      data.supplierId = patch.supplierId ? parseInt(patch.supplierId) : null;
      await assertSupplierExists(data.supplierId);
    }

    await assertCodesAvailable({ barcode: data.barcode, sku: data.sku }, productId);

    try {
      const after = await prisma.product.update({ where: { id: productId }, data });
      return { before, after };
    } catch (error) {
      return rethrowUniqueViolation(error);
    }
  },
};

module.exports = { ProductModel, ProductError, ADJUSTMENT_REASONS, prisma };
