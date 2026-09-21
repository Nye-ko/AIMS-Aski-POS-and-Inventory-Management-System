// Level and range statistics for the forecast engine — the JavaScript twin of ai-service/forecast_stats.py.
// Plain left-to-right float arithmetic, identical operation order, so both languages give the same
// numbers (checked by the golden fixture in ai-service/tests/fixtures). Change both together.
//
// A series is an array of daily amounts ending on the last complete day. An entry is null when the day
// must not be learned from (the product was out of stock, so a zero there says nothing about demand).

const INTERVAL_Z = 1.2816; // 80% central range under a normal approximation
const VARIANCE_WINDOW_DAYS = 28; // recent days used to measure how much daily sales bounce around

const lastDays = (vals, days) => vals.slice(Math.max(0, vals.length - days));

// { mean, count } of the observed entries among the last `days`; null when there are none.
const windowMean = (vals, days) => {
  let total = 0;
  let n = 0;
  for (const v of lastDays(vals, days)) {
    if (v !== null) {
      total += v;
      n += 1;
    }
  }
  return n ? { mean: total / n, count: n } : null;
};

// Sample variance of the observed entries among the last `days`; null with fewer than two.
const sampleVariance = (vals, days = VARIANCE_WINDOW_DAYS) => {
  const seen = lastDays(vals, days).filter((v) => v !== null);
  if (seen.length < 2) return null;
  let total = 0;
  for (const v of seen) total += v;
  const mean = total / seen.length;
  let acc = 0;
  for (const v of seen) acc += (v - mean) * (v - mean);
  return acc / (seen.length - 1);
};

// [low, high]: 80% range for the total over `days` days at `rate` per day. Day-to-day noise adds up with
// the number of days; the error in the rate itself (estimated from `levelDays` days) grows with the
// square of the number of days. countData: unit sales are never less noisy than Poisson.
const rangeForTotal = (rate, levelDays, variance, days, countData = false) => {
  let v = variance !== null ? variance : countData ? rate : 0;
  if (countData && rate > v) v = rate;
  const totalVar = days * v + (days * days * v) / levelDays;
  const sd = Math.sqrt(totalVar);
  const total = rate * days;
  return [Math.max(0, total - INTERVAL_Z * sd), total + INTERVAL_Z * sd];
};

module.exports = { windowMean, sampleVariance, rangeForTotal, INTERVAL_Z, VARIANCE_WINDOW_DAYS };
