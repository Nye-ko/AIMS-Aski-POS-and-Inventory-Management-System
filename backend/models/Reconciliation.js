const { prisma } = require('./Product'); // Reuse existing Prisma client instance

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

  // 2. Aggregate sales data for X-Reading Report
  getExpectedCash: async () => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const dateFilter = {
      gte: startOfToday,
      lte: endOfToday,
    };

    // Aggregate overall total sales
    const overallAggregation = await prisma.transaction.aggregate({
      _sum: {
        subtotal: true,
        discountAmount: true,
        totalAmount: true,
      },
      where: { createdAt: dateFilter },
    });

    // Aggregate total cash sales specifically
    const cashAggregation = await prisma.transaction.aggregate({
      _sum: {
        totalAmount: true,
      },
      where: {
        paymentMethod: 'CASH',
        createdAt: dateFilter,
      },
    });

    const expectedCashVal = parseFloat(cashAggregation._sum.totalAmount?.toString() || 0.0);
    const grossSalesVal = parseFloat(overallAggregation._sum.totalAmount?.toString() || 0.0);

    return {
      expectedCash: expectedCashVal,
      grossSales: grossSalesVal,
      totalDiscount: parseFloat(overallAggregation._sum.discountAmount?.toString() || 0.0),
      netSales: grossSalesVal,
      posCash: expectedCashVal,
      pointsAvailed: 0.0,
      cashDiscount: 0.0,
    };
  },

  // 3. Save reconciliation record to PostgreSQL with dynamic FK lookup
  create: async (data) => {
    const {
      reportNo,
      cashierId,
      grossSales = 0,
      pointsAvailed = 0,
      totalDiscount = 0,
      netSales = 0,
      cashDiscount = 0,
      posCash = 0,
      cashierCash = 0,
      shortOver = 0,
      denominations = {},
      notes,
      status,
    } = data;

    // cashierId is set by the route handler from the authenticated user's
    // JWT — verify it still resolves to a real user.
    const validCashierId = parseInt(cashierId, 10);
    const cashierExists = await prisma.user.findUnique({
      where: { id: validCashierId },
    });
    if (!cashierExists) {
      throw new Error('Authenticated user no longer exists.');
    }

    // Fallback report number generator
    const generatedReportNo = reportNo || `X-${Math.floor(100000 + Math.random() * 900000)}`;

    return await prisma.reconciliation.create({
      data: {
        reportNo: generatedReportNo,
        cashierId: validCashierId,

        // X-Reading Sales Totals
        grossSales: parseFloat(grossSales),
        pointsAvailed: parseFloat(pointsAvailed),
        totalDiscount: parseFloat(totalDiscount),
        netSales: parseFloat(netSales),
        cashDiscount: parseFloat(cashDiscount),

        // Denomination Breakdown
        p1000: parseInt(denominations.p1000, 10) || 0,
        p500: parseInt(denominations.p500, 10) || 0,
        p200: parseInt(denominations.p200, 10) || 0,
        p100: parseInt(denominations.p100, 10) || 0,
        p50: parseInt(denominations.p50, 10) || 0,
        p20: parseInt(denominations.p20, 10) || 0,
        p10: parseInt(denominations.p10, 10) || 0,
        p5: parseInt(denominations.p5, 10) || 0,
        p1: parseInt(denominations.p1, 10) || 0,
        p0_25: parseInt(denominations.c25 || denominations.p0_25, 10) || 0,

        // Financial Accountability Summary
        posCash: parseFloat(posCash),
        cashierCash: parseFloat(cashierCash),
        shortOver: parseFloat(shortOver),

        status: status || 'COMPLETED',
        notes: notes || 'End of Shift Audit',
      },
      include: {
        cashier: { select: { username: true } },
      },
    });
  },
};

module.exports = ReconciliationModel;