// Grades saved forecast snapshots against what actually sold. Pure functions (no DB, no clock), the
// counterpart of ai-service/backtest.py: same metrics, same "previous period" baseline, same verdict
// rules, so a backtest figure and a live figure can be read side by side.
const { dayNumber, isoFromDay } = require('./forecastEngine');

const UNITS_HORIZON = 7;
const MIN_TRAIN_DAYS = 14; // a snapshot needs this much sales history before it to be graded
const MIN_SAMPLES = 5;
const SKILL_MARGIN = 0.05;

// Round half up with the exact expression the Python backtest uses, so both report identical figures.
const rnd = (x, digits) => {
  const f = 10 ** digits;
  return Math.floor(x * f + 0.5) / f + 0;
};
const r4 = (x) => (x === null ? null : rnd(x, 4));
const r2 = (x) => rnd(x, 2);
const r3 = (x) => rnd(x, 3);

const errors = (pairs) => {
  if (!pairs.length) return { wape: null, bias: null, mae: null };
  let actual = 0;
  let abs = 0;
  let net = 0;
  for (const [f, a] of pairs) {
    actual += a;
    abs += Math.abs(f - a);
    net += f - a;
  }
  return {
    wape: actual > 0 ? r4(abs / actual) : null,
    bias: actual > 0 ? r4(net / actual) : null,
    mae: r3(abs / pairs.length),
  };
};

// rows: [[forecast, actual, naive], ...]
const summarize = (rows) => {
  const model = errors(rows.map(([f, a]) => [f, a]));
  const baseline = errors(rows.map(([, a, n]) => [n, a]));
  let skill = null;
  if (model.wape !== null && baseline.wape !== null && baseline.wape !== 0) {
    skill = r4(1 - model.wape / baseline.wape);
  }

  let verdict;
  if (rows.length < MIN_SAMPLES || model.wape === null) verdict = 'insufficient';
  else if (baseline.wape === 0) verdict = model.wape === 0 ? 'similar' : 'worse';
  else if (skill === null) verdict = 'insufficient';
  else if (skill > SKILL_MARGIN) verdict = 'better';
  else if (skill < -SKILL_MARGIN) verdict = 'worse';
  else verdict = 'similar';

  return {
    n: rows.length,
    actualTotal: r2(rows.reduce((s, [, a]) => s + a, 0)),
    forecastTotal: r2(rows.reduce((s, [f]) => s + f, 0)),
    model,
    baseline,
    skill,
    verdict,
  };
};

const sumDays = (map, lo, hi) => {
  let t = 0;
  for (let d = lo; d <= hi; d += 1) t += map.get(d) || 0;
  return t;
};

/**
 * snapshots:       [{ asOf: 'YYYY-MM-DD', revenue7, revenue30, items: [{ productId, sku, forecast7 }] }]
 * unitsByProduct:  Map(productId -> Map(dayNumber -> units))
 * grossByDay:      Map(dayNumber -> gross revenue)
 * lastCompleteDay: 'YYYY-MM-DD' (yesterday, store-local); storeStart: dayNumber of the first sale on record
 */
const gradeSnapshots = ({ snapshots, unitsByProduct, grossByDay, lastCompleteDay, storeStart }) => {
  const last = dayNumber(lastCompleteDay);
  const unitRows = [];
  const skuRows = new Map(); // productId -> { sku, rows }
  const revRows = { 7: [], 30: [] };
  let graded = 0;

  for (const snap of snapshots) {
    const o = dayNumber(snap.asOf);
    if (storeStart === null || o - storeStart < MIN_TRAIN_DAYS) continue; // too little history to baseline

    if (o + UNITS_HORIZON - 1 <= last) {
      graded += 1;
      for (const item of snap.items) {
        const series = unitsByProduct.get(item.productId) || new Map();
        const row = [
          item.forecast7,
          sumDays(series, o, o + UNITS_HORIZON - 1),
          sumDays(series, o - UNITS_HORIZON, o - 1),
        ];
        unitRows.push(row);
        if (!skuRows.has(item.productId)) skuRows.set(item.productId, { sku: item.sku, rows: [] });
        skuRows.get(item.productId).rows.push(row);
      }
    }
    for (const h of [7, 30]) {
      if (o + h - 1 > last || o - h < storeStart) continue;
      const forecast = Number(h === 7 ? snap.revenue7 : snap.revenue30);
      revRows[h].push([forecast, sumDays(grossByDay, o, o + h - 1), sumDays(grossByDay, o - h, o - 1)]);
    }
  }

  const asOfs = snapshots.map((s) => s.asOf).sort();
  return {
    meta: {
      snapshotsSaved: snapshots.length,
      snapshotsGraded: graded,
      firstAsOf: asOfs[0] || null,
      lastAsOf: asOfs[asOfs.length - 1] || null,
      lastCompleteDay,
    },
    units7: summarize(unitRows),
    revenue7: summarize(revRows[7]),
    revenue30: summarize(revRows[30]),
    perSku: [...skuRows.entries()]
      .map(([productId, { sku, rows }]) => {
        const s = summarize(rows);
        return { id: productId, sku, n: s.n, wape: s.model.wape, bias: s.model.bias, baselineWape: s.baseline.wape };
      })
      .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0)),
  };
};

module.exports = { summarize, gradeSnapshots, isoFromDay, UNITS_HORIZON, MIN_TRAIN_DAYS };
