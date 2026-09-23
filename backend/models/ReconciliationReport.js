// Stock & sales reconciliation report. Two independent cross-checks over a date range:
//   1. Per product: does opening stock + received + manual adds - returned - sold + adjustments
//      (recomputed fresh from the ledger) match what the ledger's own movement rows, or the live
//      Product.stock, actually say happened? A mismatch means something outside the normal flow
//      changed stock or edited/removed a ledger row (e.g. a bad manual DB fix).
//   2. Does the POS's own reported gross sales (Transaction.subtotal) match the revenue the SALE
//      movements carry (sourced from TransactionItem, independently of Transaction itself)?
// Not named "Reconciliation" (that model already exists for the cashier's EOD cash count).
const { prisma } = require('./Product');
const { STORE_TIMEZONE, localDate } = require('./DemandForecast');
const { loadAmounts, attachAmounts } = require('./StockMovement');

class ReconciliationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MS_PER_DAY = 86400000;

// The May–July 2026 historical sales import has no stock-ledger entries at all — by design, so it
// wouldn't double-count against the physical stock count taken at the end of July (see
// backend/importSalesData.js). Ledger/sales math is only complete, and only safe to reconcile,
// from the day right after that import ends.
const FLOOR_DATE = '2026-08-01';

const isValidDateStr = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const roundedEq = (a, b) => Math.abs(a - b) < 0.01;

const ReconciliationReportModel = {
  build: async ({ from, to }) => {
    if (!isValidDateStr(from) || !isValidDateStr(to)) {
      throw new ReconciliationError(400, '"from" and "to" are required as YYYY-MM-DD dates.');
    }
    if (from < FLOOR_DATE) {
      throw new ReconciliationError(
        400,
        `Reconciliation can't start before ${FLOOR_DATE} — the May–July 2026 sales import has no stock ledger data before then.`,
      );
    }
    if (to < from) throw new ReconciliationError(400, '"to" must be on or after "from".');

    const today = localDate(new Date(), STORE_TIMEZONE);
    const coversToday = to >= today;

    // Coarse, generously-widened UTC windows; exact day attribution happens below with localDate —
    // the same pattern TransactionModel.findForReport and the forecast loaders already use.
    // openingCutoff is always at least a day earlier than local midnight of `from`, in any
    // real timezone, so "last movement before openingCutoff" is safely before the range starts.
    const openingCutoff = new Date(Date.parse(`${from}T00:00:00Z`) - MS_PER_DAY);
    const rangeUpperBound = new Date(Date.parse(`${to}T00:00:00Z`) + 2 * MS_PER_DAY);

    const [openingRows, movements, transactions] = await Promise.all([
      prisma.$queryRaw`
        SELECT DISTINCT ON ("productId") "productId", "balanceAfter"
        FROM "StockMovement"
        WHERE "createdAt" < ${openingCutoff}
        ORDER BY "productId", "createdAt" DESC, "id" DESC
      `,
      prisma.stockMovement.findMany({
        where: { createdAt: { gte: openingCutoff, lt: rangeUpperBound } },
        include: { product: { select: { id: true, name: true, barcode: true } } },
        orderBy: { id: 'asc' },
      }),
      prisma.transaction.findMany({
        where: { createdAt: { gte: openingCutoff, lt: rangeUpperBound } },
        select: { id: true, transactionNo: true, createdAt: true, subtotal: true, discountAmount: true, totalAmount: true },
      }),
    ]);

    const openingByProduct = new Map(openingRows.map((r) => [r.productId, r.balanceAfter]));

    const inRange = movements.filter((m) => {
      const d = localDate(m.createdAt, STORE_TIMEZONE);
      return d >= from && d <= to;
    });
    const txInRange = transactions.filter((t) => {
      const d = localDate(t.createdAt, STORE_TIMEZONE);
      return d >= from && d <= to;
    });

    // --- Per-product stock math ---
    const byProduct = new Map();
    for (const m of inRange) {
      if (!byProduct.has(m.productId)) {
        byProduct.set(m.productId, {
          productId: m.productId,
          name: m.product.name,
          barcode: m.product.barcode,
          received: 0,
          manualAdd: 0,
          returned: 0,
          sold: 0,
          adjustment: 0,
          lastBalanceAfter: null,
        });
      }
      const row = byProduct.get(m.productId);
      const qty = m.quantity;
      if (m.type === 'PURCHASE_RECEIPT' || m.type === 'OPENING') row.received += qty;
      else if (m.type === 'MANUAL_ADD') row.manualAdd += qty;
      else if (m.type === 'PURCHASE_RETURN') row.returned += -qty; // positive magnitude
      else if (m.type === 'SALE') row.sold += -qty; // positive magnitude
      else if (m.type === 'ADJUSTMENT') row.adjustment += qty; // signed net
      row.lastBalanceAfter = m.balanceAfter;
    }

    const currentStockById = coversToday
      ? new Map(
          (
            await prisma.product.findMany({
              where: { id: { in: [...byProduct.keys()] } },
              select: { id: true, stock: true },
            })
          ).map((p) => [p.id, p.stock]),
        )
      : null;

    const stockRows = [...byProduct.values()]
      .map((row) => {
        const opening = openingByProduct.get(row.productId) || 0;
        const expectedClosing = opening + row.received + row.manualAdd - row.returned - row.sold + row.adjustment;
        const actualClosing = coversToday ? currentStockById.get(row.productId) : row.lastBalanceAfter;
        return {
          productId: row.productId,
          name: row.name,
          barcode: row.barcode,
          openingStock: opening,
          received: row.received,
          manualAdd: row.manualAdd,
          returned: row.returned,
          sold: row.sold,
          adjustment: row.adjustment,
          expectedClosing,
          actualClosing,
          mismatch: expectedClosing !== actualClosing,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    // --- Sales cross-check: POS's own totals vs. the revenue its SALE ledger rows carry ---
    const saleMovements = inRange.filter((m) => m.type === 'SALE');
    const amountByKey = await loadAmounts(saleMovements);
    const pricedSales = attachAmounts(saleMovements, amountByKey);
    const ledgerSaleRevenue = pricedSales.reduce((sum, m) => sum + (m.amount || 0), 0);

    const saleTxIdsWithMovement = new Set(
      saleMovements.filter((m) => m.referenceType === 'Transaction').map((m) => m.referenceId),
    );
    const transactionsWithoutMovements = txInRange
      .filter((t) => !saleTxIdsWithMovement.has(t.id))
      .map((t) => ({ id: t.id, transactionNo: t.transactionNo, totalAmount: Number(t.totalAmount) }));

    const posGrossSales = txInRange.reduce((s, t) => s + Number(t.subtotal), 0);
    const posDiscounts = txInRange.reduce((s, t) => s + Number(t.discountAmount), 0);
    const posNetSales = txInRange.reduce((s, t) => s + Number(t.totalAmount), 0);

    return {
      from,
      to,
      floorDate: FLOOR_DATE,
      stock: {
        rows: stockRows,
        mismatchCount: stockRows.filter((r) => r.mismatch).length,
      },
      sales: {
        transactionCount: txInRange.length,
        posGrossSales,
        posDiscounts,
        posNetSales,
        ledgerSaleMovementCount: saleMovements.length,
        ledgerSaleRevenue,
        mismatch: !roundedEq(posGrossSales, ledgerSaleRevenue) || transactionsWithoutMovements.length > 0,
        transactionsWithoutMovements,
      },
    };
  },
};

ReconciliationReportModel.ReconciliationError = ReconciliationError;
ReconciliationReportModel.FLOOR_DATE = FLOOR_DATE;

module.exports = { ReconciliationReportModel };
