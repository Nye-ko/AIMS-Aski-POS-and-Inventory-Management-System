const { ProductModel, prisma } = require('./Product');

class FinanceModel {
  static async getSummary() {
    // 1. Fetch sales transactions
    const transactions = await prisma.transaction.findMany({
      select: {
        totalAmount: true,
        subtotal: true,
        discountAmount: true,
        createdAt: true,
      },
    });

    let totalGross = 0;
    let totalNet = 0;
    let totalDiscounts = 0;

    const daysMap = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
    const revenueComparisonData = Object.keys(daysMap).map((day) => ({
      day,
      gross: 0,
      net: 0,
      discounts: 0,
    }));

    transactions.forEach((tx) => {
      const gross = parseFloat(tx.subtotal || tx.totalAmount || 0);
      const discount = parseFloat(tx.discountAmount || 0);
      const net = gross - discount;

      totalGross += gross;
      totalDiscounts += discount;
      totalNet += net;

      const dayName = new Date(tx.createdAt).toLocaleDateString('en-US', { weekday: 'short' });
      const target = revenueComparisonData.find((d) => d.day === dayName);
      if (target) {
        target.gross += gross;
        target.net += net;
        target.discounts += discount;
      }
    });

    // 2. Fetch shift reconciliations for drawer variance audit
    const reconciliations = await prisma.reconciliation.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        shortOver: true,
        status: true,
        cashier: { select: { username: true } },
      },
    });

    let totalVariance = 0;
    const registerVarianceData = reconciliations.map((rec, index) => {
      const variance = parseFloat(rec.shortOver || 0);
      totalVariance += variance;
      return {
        shift: `Shift #${rec.id || index + 1}`,
        cashier: rec.cashier?.username || 'Cashier',
        variance,
        status: rec.status || (variance === 0 ? 'BALANCED' : variance < 0 ? 'SHORTAGE' : 'OVERAGE'),
      };
    });

    return {
      summary: {
        totalGross: Math.round(totalGross),
        totalNet: Math.round(totalNet),
        totalDiscounts: Math.round(totalDiscounts),
        totalVariance: Math.round(totalVariance),
        netRetentionRate: totalGross > 0 ? ((totalNet / totalGross) * 100).toFixed(1) : '100.0',
      },
      revenueComparisonData,
      registerVarianceData,
    };
  }
}

module.exports = FinanceModel;