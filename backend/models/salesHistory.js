const { prisma } = require('./Product');

// Sales aggregated in SQL by store-local calendar day (not UTC), so a 7am sale in Manila belongs to
// that day. Used by both the forecast and the accuracy grading so they always see the same history.
// `since` is a coarse lower bound (a Date); callers apply their exact window.
const loadDailySales = async ({ since, timeZone }) => {
  const [salesRows, totalRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT ti."productId" AS "productId",
             to_char((t."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}::text, 'YYYY-MM-DD') AS "date",
             SUM(ti.quantity)::int AS "quantity",
             SUM(ti.subtotal)::float AS "revenue"
      FROM "TransactionItem" ti
      JOIN "Transaction" t ON t.id = ti."transactionId"
      WHERE t."createdAt" >= ${since}
      GROUP BY 1, 2`,
    prisma.$queryRaw`
      SELECT to_char((t."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}::text, 'YYYY-MM-DD') AS "date",
             SUM(t.subtotal)::float AS "gross",
             SUM(t."discountAmount")::float AS "discount",
             SUM(t."totalAmount")::float AS "net"
      FROM "Transaction" t
      WHERE t."createdAt" >= ${since}
      GROUP BY 1`,
  ]);
  return { salesRows, totalRows };
};

module.exports = { loadDailySales };
