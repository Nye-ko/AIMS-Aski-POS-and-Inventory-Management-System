const { prisma } = require('./Product');
const { dayNumber, isoFromDay } = require('../services/forecastEngine');

// Days on which a product was out of stock, from the append-only stock ledger. Sales are censored on those
// days: a zero (or a short day) says the shelf was empty, not that nobody wanted the product, so the
// forecast skips them when it estimates demand.
//
// A day counts as a stock-out when the balance was at or below zero at any point of it (it opened empty,
// or a sale/adjustment took it to zero). Days before a product's first ledger entry are unknown and are
// never reported, so history that predates the ledger is left alone.

// Pure part. daily: [{ productId, date, minBalance, endBalance }]; before: Map(productId -> balance just
// before `fromDay`); returns Map(productId -> [YYYY-MM-DD]) for fromDay..lastDay.
const deriveStockoutDays = ({ daily, before, fromDay, lastDay }) => {
  const byProduct = new Map();
  for (const r of daily) {
    if (!byProduct.has(r.productId)) byProduct.set(r.productId, new Map());
    byProduct.get(r.productId).set(r.date, r);
  }
  for (const productId of before.keys()) if (!byProduct.has(productId)) byProduct.set(productId, new Map());

  const first = dayNumber(fromDay);
  const last = dayNumber(lastDay);
  const result = new Map();
  for (const [productId, rows] of byProduct) {
    let opening = before.has(productId) ? before.get(productId) : null;
    let start = first;
    if (opening === null) {
      const firstRow = [...rows.keys()].sort()[0];
      if (firstRow === undefined) continue;
      start = Math.max(first, dayNumber(firstRow));
    }
    const out = [];
    for (let d = start; d <= last; d += 1) {
      const iso = isoFromDay(d);
      const row = rows.get(iso);
      const lowest = row ? (opening === null ? row.minBalance : Math.min(opening, row.minBalance)) : opening;
      if (lowest !== null && lowest <= 0) out.push(iso);
      if (row) opening = row.endBalance;
    }
    if (out.length) result.set(productId, out);
  }
  return result;
};

// `since` is a coarse lower bound (a Date), `fromDay`/`lastDay` the exact store-local days to report.
const loadStockoutDays = async ({ since, timeZone, fromDay, lastDay }) => {
  const [daily, before] = await Promise.all([
    prisma.$queryRaw`
      SELECT "productId" AS "productId",
             to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}::text, 'YYYY-MM-DD') AS "date",
             MIN("balanceAfter")::int AS "minBalance",
             (array_agg("balanceAfter" ORDER BY "createdAt" DESC, id DESC))[1]::int AS "endBalance"
      FROM "StockMovement"
      WHERE "createdAt" >= ${since}
      GROUP BY 1, 2`,
    prisma.$queryRaw`
      SELECT DISTINCT ON ("productId") "productId" AS "productId", "balanceAfter"::int AS "balance"
      FROM "StockMovement"
      WHERE "createdAt" < ${since}
      ORDER BY "productId", "createdAt" DESC, id DESC`,
  ]);
  return deriveStockoutDays({
    daily,
    before: new Map(before.map((r) => [r.productId, r.balance])),
    fromDay,
    lastDay,
  });
};

module.exports = { loadStockoutDays, deriveStockoutDays };
