// models/Transaction.js
const { ProductModel, prisma } = require('./Product');

const TransactionModel = {
  // Fetch all transactions with items and cashier details
  findAll: async () => {
    return await prisma.transaction.findMany({
      include: {
        items: true,
        cashier: { select: { username: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  // Process checkout, update stock, and emit real-time socket event
  createCheckout: async (payload, io) => {
    const {
      items,
      subtotal,
      discountPercent,
      discountAmount,
      totalAmount,
      paymentMethod,
      cashierId,
    } = payload;

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

    // 2. Execute database transaction
    const { transaction, stockUpdates } = await prisma.$transaction(async (tx) => {
      // Create Transaction and line items
      const newTx = await tx.transaction.create({
        data: {
          transactionNo: `TXN-${Date.now()}`,
          subtotal,
          discountPercent: discountPercent || 0,
          discountAmount: discountAmount || 0,
          totalAmount,
          paymentMethod,
          cashierId: validCashierId,
          items: {
            create: items.map((item) => ({
              productId: Number(item.productId),
              name: item.name,
              unitPrice: Number(item.unitPrice),
              quantity: Number(item.quantity),
              subtotal: Number(item.unitPrice) * Number(item.quantity),
            })),
          },
        },
        include: {
          items: true,
          cashier: { select: { username: true } },
        },
      });

      // Decrement product stock in PostgreSQL; capture post-sale stock so the
      // caller can detect low-stock crossings for email alerts.
      const stockUpdates = [];
      for (const item of items) {
        const updated = await tx.product.update({
          where: { id: Number(item.productId) },
          data: { stock: { decrement: Number(item.quantity) } },
        });
        stockUpdates.push({
          id: updated.id,
          name: updated.name,
          category: updated.category,
          newStock: updated.stock,
          minStock: updated.minStock,
          quantity: Number(item.quantity),
        });
      }

      return { transaction: newTx, stockUpdates };
    });

    if (io) {
      io.emit('transaction_created', transaction);
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

module.exports = TransactionModel;