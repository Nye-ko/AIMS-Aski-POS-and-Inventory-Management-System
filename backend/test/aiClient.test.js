const test = require('node:test');
const assert = require('node:assert/strict');
const { postJson, createBreaker, authHeaders, CircuitOpenError } = require('../services/aiClient');
const { createCache } = require('../services/forecastCache');

const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data: {} } });
const networkError = () => Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
const noWait = () => Promise.resolve();

test('a transient failure is retried once and then succeeds', async () => {
  let calls = 0;
  const post = async () => {
    calls += 1;
    if (calls === 1) throw networkError();
    return { data: { ok: true } };
  };
  const res = await postJson('http://x', {}, { timeoutMs: 100, retries: 1, post, wait: noWait });
  assert.deepEqual(res.data, { ok: true });
  assert.equal(calls, 2);
});

test('gives up after the retries and rethrows the last error', async () => {
  let calls = 0;
  const post = async () => {
    calls += 1;
    throw networkError();
  };
  await assert.rejects(postJson('http://x', {}, { timeoutMs: 100, retries: 1, post, wait: noWait }), /ECONNREFUSED/);
  assert.equal(calls, 2);
});

test('a 4xx answer is not retried and does not count against the service', async () => {
  let calls = 0;
  const breaker = createBreaker({ threshold: 1 });
  const post = async () => {
    calls += 1;
    throw httpError(422);
  };
  await assert.rejects(postJson('http://x', {}, { timeoutMs: 100, retries: 3, breaker, post, wait: noWait }), /422/);
  assert.equal(calls, 1);
  assert.equal(breaker.isOpen(), false);
});

test('the breaker opens after repeated failures, skips calls, then allows a trial after the cooldown', async () => {
  let clock = 1000;
  const breaker = createBreaker({ threshold: 3, cooldownMs: 60000, now: () => clock });
  let calls = 0;
  let healthy = false;
  const post = async () => {
    calls += 1;
    if (!healthy) throw httpError(503);
    return { data: 1 };
  };
  const call = () => postJson('http://x', {}, { timeoutMs: 100, retries: 0, breaker, post, wait: noWait });

  for (let i = 0; i < 3; i += 1) await assert.rejects(call(), /503/);
  assert.equal(calls, 3);
  assert.equal(breaker.isOpen(), true);

  await assert.rejects(call(), CircuitOpenError);
  assert.equal(calls, 3, 'no request is made while the circuit is open');

  clock += 61000;
  healthy = true;
  assert.deepEqual((await call()).data, 1);
  assert.equal(breaker.isOpen(), false);

  healthy = false;
  await assert.rejects(call(), /503/); // one failure is not enough to open it again
  assert.equal(breaker.isOpen(), false);
});

test('a success in between resets the failure count', async () => {
  const breaker = createBreaker({ threshold: 2 });
  breaker.failure();
  breaker.success();
  breaker.failure();
  assert.equal(breaker.isOpen(), false);
});

test('the shared secret is sent as X-AI-Key only when configured', () => {
  const saved = process.env.AI_SERVICE_KEY;
  try {
    delete process.env.AI_SERVICE_KEY;
    assert.deepEqual(authHeaders(), {});
    process.env.AI_SERVICE_KEY = 's3cret';
    assert.deepEqual(authHeaders(), { 'X-AI-Key': 's3cret' });
  } finally {
    if (saved === undefined) delete process.env.AI_SERVICE_KEY;
    else process.env.AI_SERVICE_KEY = saved;
  }
});

test('the cache serves repeat requests, shares an in-flight computation and expires', async () => {
  let clock = 0;
  const cache = createCache({ ttlMs: 1000, now: () => clock });
  let computes = 0;
  const compute = async () => {
    computes += 1;
    await new Promise((r) => setTimeout(r, 5));
    return { n: computes };
  };
  const [a, b] = await Promise.all([cache.get('k', compute), cache.get('k', compute)]);
  assert.equal(computes, 1);
  assert.deepEqual([a.value.n, b.value.n], [1, 1]);
  assert.equal(a.cached, false);
  assert.equal(b.cached, true);

  assert.equal((await cache.get('k', compute)).cached, true);
  clock += 1001;
  const c = await cache.get('k', compute);
  assert.equal(c.cached, false);
  assert.equal(computes, 2);
});

test('invalidate drops stored results and a computation that started before it is not stored', async () => {
  const cache = createCache({ ttlMs: 1000 });
  let computes = 0;
  const slow = async () => {
    computes += 1;
    await new Promise((r) => setTimeout(r, 20));
    return computes;
  };
  const pending = cache.get('k', slow);
  cache.invalidate(); // a sale happened while the forecast was being computed
  await pending;
  assert.equal(cache.size(), 0);
  assert.equal((await cache.get('k', slow)).cached, false);
  assert.equal(computes, 2);

  cache.invalidate();
  assert.equal(cache.size(), 0);
});

test('ttlFor can shorten or skip caching for a result', async () => {
  let clock = 0;
  const cache = createCache({ ttlMs: 1000, now: () => clock });
  let computes = 0;
  const compute = async () => ({ n: ++computes, short: true });
  await cache.get('k', compute, { ttlFor: (v) => (v.short ? 100 : 1000) });
  clock += 101;
  assert.equal((await cache.get('k', compute, { ttlFor: () => 100 })).cached, false);
  await cache.get('z', compute, { ttlFor: () => 0 });
  assert.equal(cache.size(), 1);
});

test('a failed computation is not cached and does not poison later requests', async () => {
  const cache = createCache({ ttlMs: 1000 });
  await assert.rejects(cache.get('k', async () => { throw new Error('boom'); }), /boom/);
  assert.equal((await cache.get('k', async () => 7)).value, 7);
});

test('the cache never holds more than maxEntries', async () => {
  const cache = createCache({ ttlMs: 1000, maxEntries: 2 });
  for (const k of ['a', 'b', 'c']) await cache.get(k, async () => k);
  assert.equal(cache.size(), 2);
});
