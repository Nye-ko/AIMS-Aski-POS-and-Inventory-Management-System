// models/Product.js
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Shared formatter so every route returns the same product shape the frontend expects
// (unitCost/sellingPrice/supplierName/status), not the raw Prisma record.
const formatProduct = (p) => {
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
    sellingPrice: Number(p.price),
    expiryDate: p.expiryDate,
    createdAt: p.createdAt,
    supplierId: p.supplierId,
    supplierName: p.supplier ? p.supplier.name : 'N/A',
    status,
  };
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

    return products.map(formatProduct);
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

  // Create a new product with all inventory fields
  create: async (data) => {
    const product = await prisma.product.create({
      data: {
        name: data.name,
        barcode: data.barcode || null,
        sku: data.sku || null,
        category: data.category || 'Uncategorized',
        unit: data.unit || 'PC/S',
        // Inventory form sends sellingPrice/unitCost; fall back to price/costPrice for other callers
        price: parseFloat(data.sellingPrice ?? data.price ?? 0),
        costPrice: parseFloat(data.unitCost ?? data.costPrice ?? 0),
        stock: parseInt(data.currentStock ?? data.stock) || 0,
        minStock: parseInt(data.minStock) || 10,
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
        supplierId: data.supplierId ? parseInt(data.supplierId) : null,
      },
      include: { supplier: true },
    });

    return formatProduct(product);
  },

  // Add stock increment to existing product, optionally recording the supplying vendor
  addStock: async (id, quantity, supplierId) => {
    const product = await prisma.product.update({
      where: { id: parseInt(id) },
      data: {
        stock: { increment: parseInt(quantity) },
        ...(supplierId ? { supplierId: parseInt(supplierId) } : {}),
      },
      include: { supplier: true },
    });

    return formatProduct(product);
  },
};

module.exports = { ProductModel, prisma };