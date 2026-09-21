const { prisma } = require('./Product'); // Reuse existing Prisma client instance

class ReconciliationError extends Error {
  constructor(status, message, code = 'RECONCILIATION_REJECTED') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Denomination keys accepted from the client, mapped to their peso value in centavos.
const DENOMINATION_CENTS = {
  p1000: 100000,
  p500: 50000,
  p200: 20000,
  p100: 10000,
  p50: 5000,
  p20: 2000,
  p10: 1000,
  p5: 500,
  p1: 100,
  p0_50: 50,
  p0_25: 25,
  p0_10: 10,
  p0_05: 5,
  p0_01: 1,
};

const toCents = (value) => Math.round(Number(value || 0) * 100);
const centsToNumber = (cents) => cents / 100;

const pad = (n) => String(n).padStart(2, '0');

// "Today" follows the server's local clock, matching how the daily digest is scheduled.
const getToday = () => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const dateKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return { start, end, dateKey };
};

// The cashier's own sales for today, all computed from stored transactions.
const summarizeToday = async (cashierId, client = prisma) => {
  const { start, end, dateKey } = getToday();
  const createdAt = { gte: start, lte: end };

  const [overall, cash] = await Promise.all([
    client.transaction.aggregate({
      _sum: { subtotal: true, discountAmount: true, totalAmount: true },
      where: { cashierId, createdAt },
    }),
    client.transaction.aggregate({
      _sum: { totalAmount: true },
      where: { cashierId, paymentMethod: 'CASH', createdAt },
    }),
  ]);

  return {
    dateKey,
    grossSalesCents: toCents(overall._sum.subtotal),
    totalDiscountCents: toCents(overall._sum.discountAmount),
    netSalesCents: toCents(overall._sum.totalAmount),
    posCashCents: toCents(cash._sum.totalAmount),
  };
};

const ReconciliationModel = {
  // 1. Fetch all past reconciliations with cashier details
  findAll: async () => {
    return await prisma.reconciliation.findMany({
      include: {
        cashier: {
          select: { id: true, username: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  // 2. X-Reading figures for one cashier's day: what the register should hold.
  getExpectedCash: async (cashierId) => {
    const summary = await summarizeToday(cashierId);
    const existing = await prisma.reconciliation.findFirst({
      where: { cashierId, businessDate: summary.dateKey },
      select: { reportNo: true },
    });

    return {
      expectedCash: centsToNumber(summary.posCashCents),
      grossSales: centsToNumber(summary.grossSalesCents),
      totalDiscount: centsToNumber(summary.totalDiscountCents),
      netSales: centsToNumber(summary.netSalesCents),
      posCash: centsToNumber(summary.posCashCents),
      pointsAvailed: 0,
      cashDiscount: 0,
      alreadyClosed: !!existing,
      closedReportNo: existing ? existing.reportNo : null,
    };
  },

  // 3. Close the cashier's day. Every money figure is recomputed here; the client only
  // contributes the denomination counts and optional notes.
  create: async ({ cashierId, denominations = {}, notes }) => {
    // cashierId is set by the route handler from the authenticated user's
    // JWT — verify it still resolves to a real user.
    const validCashierId = parseInt(cashierId, 10);
    const cashierExists = await prisma.user.findUnique({
      where: { id: validCashierId },
    });
    if (!cashierExists) {
      throw new Error('Authenticated user no longer exists.');
    }

    const counts = {};
    let cashierCashCents = 0;
    for (const [key, cents] of Object.entries(DENOMINATION_CENTS)) {
      const raw = key === 'p0_25' ? (denominations.c25 ?? denominations.p0_25) : denominations[key];
      const count = Math.min(1000000, Math.max(0, parseInt(raw, 10) || 0));
      counts[key] = count;
      cashierCashCents += count * cents;
    }

    return await prisma.$transaction(async (tx) => {
      const { dateKey } = getToday();
      // Serialise concurrent closes for the same cashier and day so the duplicate check below is race-free.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${validCashierId}::int, ${parseInt(dateKey.replace(/-/g, ''), 10)}::int)::text AS locked`;

      const existing = await tx.reconciliation.findFirst({
        where: { cashierId: validCashierId, businessDate: dateKey },
        select: { reportNo: true },
      });
      if (existing) {
        throw new ReconciliationError(
          409,
          `Today's register was already closed (report ${existing.reportNo}).`,
          'ALREADY_CLOSED',
        );
      }

      const summary = await summarizeToday(validCashierId, tx);
      const shortOverCents = cashierCashCents - summary.posCashCents;
      const status = shortOverCents === 0 ? 'BALANCED' : shortOverCents < 0 ? 'SHORTAGE' : 'OVERAGE';

      return await tx.reconciliation.create({
        data: {
          reportNo: `X-${dateKey.replace(/-/g, '')}-${validCashierId}`,
          businessDate: dateKey,
          cashierId: validCashierId,

          // X-Reading Sales Totals
          grossSales: centsToNumber(summary.grossSalesCents),
          pointsAvailed: 0,
          totalDiscount: centsToNumber(summary.totalDiscountCents),
          netSales: centsToNumber(summary.netSalesCents),
          cashDiscount: 0,

          // Denomination Breakdown
          ...counts,

          // Financial Accountability Summary
          posCash: centsToNumber(summary.posCashCents),
          cashierCash: centsToNumber(cashierCashCents),
          shortOver: centsToNumber(shortOverCents),

          status,
          notes: typeof notes === 'string' && notes.trim() ? notes.trim().slice(0, 500) : 'End of Shift Audit',
        },
        include: {
          cashier: { select: { username: true } },
        },
      });
    });
  },
};

ReconciliationModel.ReconciliationError = ReconciliationError;

module.exports = ReconciliationModel;
