// Calls to the AI microservice: a short timeout, one retry for transient failures, a circuit breaker so a dead
// service is not retried on every request, and an optional shared secret (AI_SERVICE_KEY, sent as X-AI-Key).
// Everything here fails soft: callers catch the error and use the built-in engine instead.
const axios = require('axios');

const KEY_HEADER = 'X-AI-Key';

const authHeaders = () => (process.env.AI_SERVICE_KEY ? { [KEY_HEADER]: process.env.AI_SERVICE_KEY } : {});

class CircuitOpenError extends Error {
  constructor(retryInMs) {
    super(`AI service skipped after repeated failures (trying again in ${Math.ceil(retryInMs / 1000)}s)`);
    this.name = 'CircuitOpenError';
  }
}

// Opens after `threshold` consecutive failed calls and stays open for `cooldownMs`; the first call after that
// is a trial: success closes the circuit, failure re-opens it for another cooldown.
const createBreaker = ({ threshold = 3, cooldownMs = 60000, now = Date.now } = {}) => {
  let failures = 0;
  let openedAt = null;
  return {
    check() {
      if (openedAt === null) return;
      const waited = now() - openedAt;
      if (waited < cooldownMs) throw new CircuitOpenError(cooldownMs - waited);
    },
    success() {
      failures = 0;
      openedAt = null;
    },
    failure() {
      failures += 1;
      if (failures >= threshold) openedAt = now();
    },
    isOpen: () => openedAt !== null && now() - openedAt < cooldownMs,
  };
};

// A 4xx means the request itself was refused (bad payload, wrong key): retrying cannot help and the service is up.
const isTransient = (error) => !(error.response && error.response.status >= 400 && error.response.status < 500);

// `post` and `wait` are injectable for tests.
const postJson = async (url, body, { timeoutMs, retries = 1, retryDelayMs = 200, breaker, post = axios.post, wait } = {}) => {
  const sleep = wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  if (breaker) breaker.check();
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await post(url, body, { timeout: timeoutMs, headers: authHeaders() });
      if (breaker) breaker.success();
      return response;
    } catch (error) {
      lastError = error;
      if (!isTransient(error)) {
        if (breaker) breaker.success(); // it answered, so it is alive
        throw error;
      }
      if (attempt < retries) await sleep(retryDelayMs);
    }
  }
  if (breaker) breaker.failure();
  throw lastError;
};

module.exports = { postJson, createBreaker, authHeaders, CircuitOpenError, KEY_HEADER };
