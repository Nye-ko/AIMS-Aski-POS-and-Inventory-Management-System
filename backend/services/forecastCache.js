// A small in-memory cache for computed forecasts. Concurrent requests for the same key share one computation,
// and `invalidate()` (called after any successful write request) drops everything, including results that were
// still being computed when the write happened, so a stale answer can never be stored after a sale.
const createCache = ({ ttlMs = 300000, maxEntries = 20, now = Date.now } = {}) => {
  const entries = new Map(); // key -> { value, expiresAt }
  const inflight = new Map(); // key -> Promise
  let generation = 0;

  return {
    // `ttlFor(value)` lets a result choose a shorter life (a fallback forecast should be retried soon).
    async get(key, compute, { ttlFor } = {}) {
      const hit = entries.get(key);
      if (hit && hit.expiresAt > now()) return { value: hit.value, cached: true, storedAt: hit.storedAt };
      if (hit) entries.delete(key);
      if (inflight.has(key)) return { value: await inflight.get(key), cached: true };

      const startedIn = generation;
      const promise = (async () => {
        const value = await compute();
        if (startedIn === generation) {
          const life = ttlFor ? ttlFor(value) : ttlMs;
          if (life > 0) {
            entries.set(key, { value, expiresAt: now() + life, storedAt: now() });
            while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
          }
        }
        return value;
      })();
      inflight.set(key, promise);
      try {
        return { value: await promise, cached: false };
      } finally {
        if (inflight.get(key) === promise) inflight.delete(key);
      }
    },
    invalidate() {
      generation += 1;
      entries.clear();
      inflight.clear();
    },
    size: () => entries.size,
  };
};

module.exports = { createCache };
