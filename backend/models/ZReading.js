// A cashier's Z-Reading: the supervisor-gated, printed sales report that closes out everything
// they've rung up since their last one. Modeled on a real BIR-style Z-Reading receipt (gross,
// discounts, per-category totals, per-payment-method totals, and a running store-wide grand
// total) — see prisma/schema.prisma's ZReadingLog for field-by-field notes on what each figure
// means and why.
const { prisma } = require('./Product');

class ZReadingError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Z-YYYYMMDD-#### — date-stamped, uniqueness guaranteed by the row's own id, same convention as
// PO-/RR-/PR- numbers elsewhere in this app.
const generateReportNo = (id, date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `Z-${y}${m}${d}-${String(id).padStart(4, '0')}`;
};

// Everything a Z-Reading needs, computed fresh from the ledger — used both for the real `create`
// (inside its own locked transaction) and could be reused for a future preview if ever needed.
const buildSummary = async (client, cashierId) => {
  const lastLog = await client.zReadingLog.findFirst({
    where: { cashierId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  const since = lastLog ? lastLog.createdAt : new Date(0);

  const transactions = await client.transaction.findMany({
    where: { cashierId, createdAt: { gt: since } },
    orderBy: { id: 'asc' },
    include: { items: { include: { product: { select: { category: true } } } } },
  });

  const paymentMap = new Map();
  const categoryMap = new Map();
  let grossSales = 0;
  let totalDiscount = 0;
  let netSales = 0;

  for (const t of transactions) {
    grossSales += Number(t.subtotal);
    totalDiscount += Number(t.discountAmount);
    netSales += Number(t.totalAmount);

    const pRow = paymentMap.get(t.paymentMethod) || { method: t.paymentMethod, count: 0, amount: 0 };
    pRow.count += 1;
    pRow.amount += Number(t.subtotal);
    paymentMap.set(t.paymentMethod, pRow);

    for (const item of t.items) {
      const category = item.product?.category || 'Uncategorized';
      const cRow = categoryMap.get(category) || { category, quantity: 0, amount: 0 };
      cRow.quantity += item.quantity;
      cRow.amount += Number(item.subtotal);
      categoryMap.set(category, cRow);
    }
  }

  const first = transactions[0] || null;
  const last = transactions[transactions.length - 1] || null;

  // Store-wide (every cashier, not just this one) cumulative sales as of the last transaction
  // this reading covers — so New Grand Total always advances by exactly this reading's own net
  // sales, the same way it does on a real machine's printout.
  const cutoff = last ? last.createdAt : new Date();
  const grandTotalAgg = await client.transaction.aggregate({
    _sum: { totalAmount: true },
    where: { createdAt: { lte: cutoff } },
  });
  const grandTotalAfter = Number(grandTotalAgg._sum.totalAmount || 0);
  const grandTotalBefore = grandTotalAfter - netSales;

  return {
    fromTransactionId: first?.id ?? null,
    toTransactionId: last?.id ?? null,
    beginTransactionNo: first?.transactionNo ?? null,
    endTransactionNo: last?.transactionNo ?? null,
    transactionCount: transactions.length,
    grossSales,
    totalDiscount,
    pointsAvailed: 0, // no points-redemption feature yet — always 0 until one exists
    netSales,
    grandTotalBefore,
    grandTotalAfter,
    paymentBreakdown: [...paymentMap.values()],
    categoryBreakdown: [...categoryMap.values()].sort((a, b) => b.amount - a.amount),
  };
};

const ZReadingModel = {
  // Locks in the period and persists the log. `cashierId` is whose shift this closes;
  // `approvedById` is the supervisor who authorized it (see services/posApproval.js, action ZREAD).
  create: async (cashierId, approvedById) => {
    const cashier = await prisma.user.findUnique({ where: { id: cashierId }, select: { id: true } });
    if (!cashier) throw new ZReadingError(404, 'Cashier not found.');

    return prisma.$transaction(
      async (tx) => {
        // Serializes concurrent Z-Readings for the same cashier so a double-click can't compute
        // two overlapping ranges — the second call only proceeds once the first has committed,
        // and will then correctly see an empty (already-covered) range instead of double-counting.
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${cashierId} FOR UPDATE`;

        const summary = await buildSummary(tx, cashierId);

        const created = await tx.zReadingLog.create({
          data: {
            reportNo: `TEMP-${Date.now()}`,
            cashierId,
            approvedById,
            ...summary,
          },
        });

        return tx.zReadingLog.update({
          where: { id: created.id },
          data: { reportNo: generateReportNo(created.id, created.createdAt) },
          include: {
            cashier: { select: { username: true, fullName: true } },
            approvedBy: { select: { username: true } },
          },
        });
      },
      { timeout: 20000 },
    );
  },

  findAll: async ({ cashierId } = {}) => {
    const where = {};
    const cid = parseInt(cashierId, 10);
    if (cid) where.cashierId = cid;
    return prisma.zReadingLog.findMany({
      where,
      include: {
        cashier: { select: { username: true, fullName: true } },
        approvedBy: { select: { username: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },
};

ZReadingModel.ZReadingError = ZReadingError;

module.exports = { ZReadingModel };
