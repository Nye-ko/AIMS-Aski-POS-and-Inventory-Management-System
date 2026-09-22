// models/Transaction.js
const { ProductModel, prisma } = require('./Product');
const { verifyApproval, consumeApproval } = require('../services/posApproval');
const { recordMovement } = require('./stockLedger');
const { STORE_TIMEZONE, localDate } = require('./DemandForecast');

class CheckoutError extends Error {
  constructor(status, message, code = 'CHECKOUT_REJECTED') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const toCents = (value) => Math.round(Number(value) * 100);

// The client sends "Cash" / "Card" / "E-wallet"; the database enum spells the last one E_wallet.
const PAYMENT_METHODS = { CASH: 'CASH', CARD: 'CARD', E_WALLET: 'E_wallet', EWALLET: 'E_wallet' };
const normalizePaymentMethod = (value) => {
  const key = String(value || 'CASH').toUpperCase().replace(/[\s-]+/g, '_');
  const method = PAYMENT_METHODS[key];
  if (!method) throw new CheckoutError(400, 'Unsupported payment method.');
  return method;
};

const TransactionModel = {
  // Fetch all transactions with items and cashier details
  findAll: async ({ limit } = {}) => {
    return await prisma.transaction.findMany({
      include: {
        items: true,
        cashier: { select: { username: true } },
      },
      orderBy: { createdAt: 'desc' },
      ...(limit ? { take: limit } : {}),
    });
  },

  // One row per transaction for a given store-local calendar month (default: the current month),
  // for the Sales Report page. Transactions are fetched over a coarse UTC window (a day of slack on
  // each side) and filtered precisely with localDate, the same pattern loadForecastInput uses.
  findForReport: async ({ month } = {}) => {
    const targetMonth = /^\d{4}-\d{2}$/.test(month) ? month : localDate(new Date(), STORE_TIMEZONE).slice(0, 7);
    const [year, mon] = targetMonth.split('-').map(Number);
    const from = new Date(Date.UTC(year, mon - 1, 1) - 86400000);
    const to = new Date(Date.UTC(year, mon, 1) + 86400000);

    const transactions = await prisma.transaction.findMany({
      where: { createdAt: { gte: from, lt: to } },
      include: {
        items: { select: { quantity: true } },
        cashier: { select: { username: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const rows = transactions
      .filter((t) => localDate(t.createdAt, STORE_TIMEZONE).slice(0, 7) === targetMonth)
      .map((t) => ({
        id: t.id,
        transactionNo: t.transactionNo,
        createdAt: t.createdAt,
        itemsCount: t.items.length,
        subtotal: t.subtotal,
        discountAmount: t.discountAmount,
        totalAmount: t.totalAmount,
        paymentMethod: t.paymentMethod,
        cashier: t.cashier?.username || null,
      }));

    const totals = rows.reduce(
      (acc, r) => ({
        count: acc.count + 1,
        subtotal: acc.subtotal + Number(r.subtotal),
        discountAmount: acc.discountAmount + Number(r.discountAmount),
        totalAmount: acc.totalAmount + Number(r.totalAmount),
      }),
      { count: 0, subtotal: 0, discountAmount: 0, totalAmount: 0 },
    );

    return { month: targetMonth, rows, totals };
  },

  // Process checkout, update stock, and emit real-time socket event.
  // Prices, totals and the discount are recomputed here from the database — the
  // client only says which products, how many, and which discount % it was approved for.
  createCheckout: async (payload, io) => {
    const { items, discountPercent, totalAmount: clientTotal, paymentMethod, cashierId, approvalToken } = payload;

    // cashierId is set by the route handler from the authenticated user's
    // JWT (see authenticateToken in models/Auth.js) — verify it still
    // resolves to a real user rather than silently reattributing the sale.
    const validCashierId = Number(cashierId);
    const cashierExists = await prisma.user.findUnique({
      where: { id: validCashierId },
    });
    if (!cashierExists) {
      throw new Error('Authenticated user no longer exists.');
    }

    const method = normalizePaymentMethod(paymentMethod);

    if (!Array.isArray(items) || items.length === 0) {
      throw new CheckoutError(400, 'Cart is empty.');
    }
    const quantities = new Map();
    for (const item of items) {
      const productId = Number(item && item.productId);
      const quantity = Number(item && item.quantity);
      if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity <= 0) {
        throw new CheckoutError(400, 'Each cart item needs a valid product and a whole-number quantity.');
      }
      quantities.set(productId, (quantities.get(productId) || 0) + quantity);
    }

    const pct = Number(discountPercent || 0);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new CheckoutError(400, 'Discount must be between 0% and 100%.');
    }
    const approval =
      pct > 0
        ? await verifyApproval(approvalToken, { action: 'DISCOUNT', cashierId: validCashierId, discountPercent: pct })
        : null;

    const { transaction, stockUpdates } = await prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({ where: { id: { in: [...quantities.keys()] } } });
      const byId = new Map(products.map((p) => [p.id, p]));

      const lines = [];
      let subtotalCents = 0;
      for (const [productId, quantity] of quantities) {
        const product = byId.get(productId);
        if (!product) throw new CheckoutError(400, `Product #${productId} no longer exists.`, 'PRODUCT_NOT_FOUND');
        const unitCents = toCents(product.price);
        subtotalCents += unitCents * quantity;
        lines.push({ product, quantity, unitCents });
      }
      const discountCents = Math.round((subtotalCents * pct) / 100);
      const totalCents = subtotalCents - discountCents;

      if (clientTotal !== undefined && Math.abs(toCents(clientTotal) - totalCents) > 1) {
        throw new CheckoutError(
          409,
          'Prices changed since this cart was built. The product list has been refreshed — please review the cart.',
          'PRICE_CHANGED',
        );
      }

      // Guarded decrement: the WHERE clause makes the stock check and the update atomic,
      // so two simultaneous sales can never push stock below zero.
      for (const { product, quantity } of lines) {
        const { count } = await tx.product.updateMany({
          where: { id: product.id, stock: { gte: quantity } },
          data: { stock: { decrement: quantity } },
        });
        if (count === 0) {
          const fresh = await tx.product.findUnique({ where: { id: product.id }, select: { stock: true } });
          throw new CheckoutError(
            409,
            `Not enough stock for "${product.name}" (available: ${fresh ? fresh.stock : 0}, requested: ${quantity}).`,
            'INSUFFICIENT_STOCK',
          );
        }
      }

      const newTx = await tx.transaction.create({
        data: {
          transactionNo: `TXN-${Date.now()}`,
          subtotal: subtotalCents / 100,
          discountPercent: pct,
          discountAmount: discountCents / 100,
          supervisorAuthorized: !!approval,
          approvedById: approval ? approval.approverId : null,
          totalAmount: totalCents / 100,
          paymentMethod: method,
          cashierId: validCashierId,
          items: {
            create: lines.map(({ product, quantity, unitCents }) => ({
              productId: product.id,
              barcode: product.barcode,
              name: product.name,
              unitPrice: unitCents / 100,
              quantity,
              subtotal: (unitCents * quantity) / 100,
            })),
          },
        },
        include: {
          items: true,
          cashier: { select: { username: true } },
        },
      });

      // Capture post-sale stock so the caller can detect low-stock crossings for email alerts.
      const after = await tx.product.findMany({ where: { id: { in: lines.map((l) => l.product.id) } } });
      const afterById = new Map(after.map((p) => [p.id, p]));
      for (const { product, quantity } of lines) {
        await recordMovement(tx, {
          productId: product.id,
          type: 'SALE',
          quantity: -quantity,
          balanceAfter: afterById.get(product.id).stock,
          referenceType: 'Transaction',
          referenceId: newTx.id,
          referenceNo: newTx.transactionNo,
          userId: validCashierId,
        });
      }

      const stockUpdates = lines.map(({ product, quantity }) => {
        const updated = afterById.get(product.id);
        return {
          id: updated.id,
          name: updated.name,
          category: updated.category,
          newStock: updated.stock,
          minStock: updated.minStock,
          quantity,
        };
      });

      return { transaction: newTx, stockUpdates };
    });

    if (approval) consumeApproval(approval);

    if (io) {
      io.to('dashboard').emit('transaction_created', transaction);
    }

    // Attach stockUpdates onto the returned object as a non-enumerable property
    // so JSON responses stay identical to today's behaviour but the route
    // handler can still read it for the low-stock crossing alert.
    Object.defineProperty(transaction, '_stockUpdates', {
      value: stockUpdates,
      enumerable: false,
    });

    return transaction;
  },
};

TransactionModel.CheckoutError = CheckoutError;

module.exports = TransactionModel;