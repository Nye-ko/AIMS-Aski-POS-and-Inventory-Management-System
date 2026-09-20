// Transaction-scoped helpers for the stock ledger. Deliberately import-free (they only touch the
// `tx` client they are given) so Product.js can use them without a circular require.

class StockError extends Error {
  constructor(status, message, code = 'STOCK_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Types that put stock on the shelf; the latest of these is a product's "batch"/arrival date.
const STOCK_IN_TYPES = ['OPENING', 'PURCHASE_RECEIPT', 'MANUAL_ADD'];

const recordMovement = (tx, { productId, type, quantity, balanceAfter, reason, referenceType, referenceId, referenceNo, userId }) =>
  tx.stockMovement.create({
    data: {
      productId,
      type,
      quantity,
      balanceAfter,
      reason: reason || null,
      referenceType: referenceType || null,
      referenceId: referenceId ?? null,
      referenceNo: referenceNo || null,
      userId: userId ?? null,
    },
  });

// Applies a signed stock change and logs it in the same transaction. Removals use a guarded
// update so stock can never go negative, even with concurrent sales. Returns the new balance.
const changeStock = async (tx, { productId, delta, ...movement }) => {
  if (!Number.isInteger(delta) || delta === 0) throw new StockError(400, 'Stock change must be a non-zero whole number.');

  let balanceAfter;
  if (delta > 0) {
    const updated = await tx.product.update({
      where: { id: productId },
      data: { stock: { increment: delta } },
      select: { stock: true },
    });
    balanceAfter = updated.stock;
  } else {
    const { count } = await tx.product.updateMany({
      where: { id: productId, stock: { gte: -delta } },
      data: { stock: { decrement: -delta } },
    });
    if (count === 0) throw new StockError(409, 'Not enough stock for this change.', 'INSUFFICIENT_STOCK');
    const fresh = await tx.product.findUnique({ where: { id: productId }, select: { stock: true } });
    balanceAfter = fresh.stock;
  }

  await recordMovement(tx, { productId, quantity: delta, balanceAfter, ...movement });
  return balanceAfter;
};

module.exports = { StockError, STOCK_IN_TYPES, recordMovement, changeStock };
