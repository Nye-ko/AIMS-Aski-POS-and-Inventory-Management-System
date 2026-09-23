// Transaction-scoped FIFO stock-batch helpers. Deliberately import-free (they only touch the
// `tx` client they are given) so Product.js/ReceivingReport.js/etc. can use them without a
// circular require — same pattern as stockLedger.js.

// Creates a new batch when stock comes IN: a receiving report, a manual "Add Stock", an opening
// balance on a new product, or a positive quantity adjustment (a count correction upward).
const createBatch = (tx, { productId, supplierId, unitCost, quantity, referenceType, referenceId, referenceNo, receivedAt }) =>
  tx.stockBatch.create({
    data: {
      productId,
      supplierId: supplierId ?? null,
      unitCost,
      qtyReceived: quantity,
      qtyRemaining: quantity,
      referenceType: referenceType || null,
      referenceId: referenceId ?? null,
      referenceNo: referenceNo || null,
      ...(receivedAt ? { receivedAt } : {}),
    },
  });

// Consumes `quantity` units of a product from its oldest batches first (FIFO), decrementing each
// batch's qtyRemaining. Returns the batches drawn from as { batchId, quantity, unitCost }, oldest
// first. If a product's batches don't cover the full quantity — e.g. drift from stock that existed
// before batch tracking was introduced — the shortfall comes back as one unbatched line priced at
// `fallbackUnitCost`, so a sale is never blocked by a costing gap (Product.stock's own guarded
// decrement is what actually prevents overselling; this only affects COGS attribution).
const consumeFIFO = async (tx, productId, quantity, fallbackUnitCost) => {
  let remaining = quantity;
  const consumed = [];

  const batches = await tx.stockBatch.findMany({
    where: { productId, qtyRemaining: { gt: 0 } },
    orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
  });

  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, batch.qtyRemaining);
    await tx.stockBatch.update({ where: { id: batch.id }, data: { qtyRemaining: { decrement: take } } });
    consumed.push({ batchId: batch.id, quantity: take, unitCost: Number(batch.unitCost) });
    remaining -= take;
  }

  if (remaining > 0) {
    consumed.push({ batchId: null, quantity: remaining, unitCost: Number(fallbackUnitCost) || 0 });
  }

  return consumed;
};

// Removes `quantity` units from one specific batch — used by Purchase Returns, which already know
// exactly which delivery they're sending back. Whatever that batch can't cover (e.g. some of it
// was already sold) falls back to FIFO across the product's other batches.
const consumeFromBatch = async (tx, batchId, quantity, productId, fallbackUnitCost) => {
  const batch = batchId ? await tx.stockBatch.findUnique({ where: { id: batchId } }) : null;
  if (!batch) return consumeFIFO(tx, productId, quantity, fallbackUnitCost);

  const take = Math.min(quantity, batch.qtyRemaining);
  const consumed = [];
  if (take > 0) {
    await tx.stockBatch.update({ where: { id: batch.id }, data: { qtyRemaining: { decrement: take } } });
    consumed.push({ batchId: batch.id, quantity: take, unitCost: Number(batch.unitCost) });
  }
  const remainder = quantity - take;
  if (remainder > 0) consumed.push(...(await consumeFIFO(tx, productId, remainder, fallbackUnitCost)));
  return consumed;
};

// The batch a Receiving Report created for one of its lines — Purchase Returns use this to find
// which specific batch a returned line should come out of first.
const findBatchByReceivingReport = (tx, productId, receivingReportId) =>
  tx.stockBatch.findFirst({ where: { productId, referenceType: 'ReceivingReport', referenceId: receivingReportId } });

module.exports = { createBatch, consumeFIFO, consumeFromBatch, findBatchByReceivingReport };
