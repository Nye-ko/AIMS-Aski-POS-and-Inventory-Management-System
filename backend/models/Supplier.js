const { prisma } = require('./Product');
const { cleanSupplierName, findSupplierByName } = require('../services/supplierName');

class SupplierError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MAX_LEAD_TIME_DAYS = 90;
const MAX_CONTACT_FIELD_LENGTH = 150;
const MAX_ADDRESS_LENGTH = 300;

// undefined (field not sent) is left alone by the caller; '' or null clears the field; otherwise
// trimmed/space-collapsed like a supplier name.
const cleanField = (value, label, max = MAX_CONTACT_FIELD_LENGTH) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const trimmed = String(value).replace(/\s+/g, ' ').trim();
  if (trimmed.length > max) throw new SupplierError(400, `${label} is too long.`);
  return trimmed || null;
};

const cleanEmail = (value) => {
  const cleaned = cleanField(value, 'Email');
  if (cleaned && !cleaned.includes('@')) throw new SupplierError(400, 'Email does not look valid.');
  return cleaned;
};

const parseLeadTime = (value) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LEAD_TIME_DAYS) {
    throw new SupplierError(400, `Lead time must be a whole number of days from 1 to ${MAX_LEAD_TIME_DAYS}.`);
  }
  return n;
};

// Names are compared ignoring case/spacing (same rule the Purchase Order combobox uses), so this page
// can't create the kind of near-duplicate supplier that combobox is designed to prevent.
const assertNameAvailable = async (name, excludeId) => {
  const suppliers = await prisma.supplier.findMany({ select: { id: true, name: true } });
  const clash = findSupplierByName(suppliers.filter((s) => s.id !== excludeId), name);
  if (clash) throw new SupplierError(409, `A supplier named "${clash.name}" already exists.`);
};

const withCounts = ({ _count, ...s }) => ({ ...s, productCount: _count.products, purchaseOrderCount: _count.purchaseOrders });

const findAll = async () => {
  const suppliers = await prisma.supplier.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { products: true, purchaseOrders: true } } },
  });
  return suppliers.map(withCounts);
};

const create = async (data) => {
  const name = cleanSupplierName(data.name);
  if (!name) throw new SupplierError(400, 'Supplier name is required.');
  await assertNameAvailable(name, null);

  const supplier = await prisma.supplier.create({
    data: {
      name,
      contactPerson: cleanField(data.contactPerson, 'Contact person') ?? null,
      email: cleanEmail(data.email) ?? null,
      phone: cleanField(data.phone, 'Phone') ?? null,
      address: cleanField(data.address, 'Address', MAX_ADDRESS_LENGTH) ?? null,
      leadTimeDays: data.leadTimeDays === undefined ? undefined : parseLeadTime(data.leadTimeDays),
    },
    include: { _count: { select: { products: true, purchaseOrders: true } } },
  });
  return withCounts(supplier);
};

// Partial update: only fields present in `data` are changed.
const update = async (id, data) => {
  const supplierId = parseInt(id, 10);
  if (!Number.isInteger(supplierId)) throw new SupplierError(400, 'Invalid supplier id.');
  const existing = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true } });
  if (!existing) return null;

  const patch = {};
  if (data.name !== undefined) {
    const name = cleanSupplierName(data.name);
    if (!name) throw new SupplierError(400, 'Supplier name is required.');
    await assertNameAvailable(name, supplierId);
    patch.name = name;
  }
  if (data.contactPerson !== undefined) patch.contactPerson = cleanField(data.contactPerson, 'Contact person');
  if (data.email !== undefined) patch.email = cleanEmail(data.email);
  if (data.phone !== undefined) patch.phone = cleanField(data.phone, 'Phone');
  if (data.address !== undefined) patch.address = cleanField(data.address, 'Address', MAX_ADDRESS_LENGTH);
  if (data.leadTimeDays !== undefined) patch.leadTimeDays = parseLeadTime(data.leadTimeDays);

  const supplier = await prisma.supplier.update({
    where: { id: supplierId },
    data: patch,
    include: { _count: { select: { products: true, purchaseOrders: true } } },
  });
  return withCounts(supplier);
};

module.exports = { SupplierError, findAll, create, update, MAX_LEAD_TIME_DAYS };
