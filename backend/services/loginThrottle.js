// In-memory brute-force guard shared by login, password re-verification and password change.
// 5 failures for one username inside 15 minutes lock that username for 15 minutes. Unknown
// usernames are tracked too, so a lockout never reveals whether an account exists.
// State is per process and resets on restart (same trade-off as the POS approval lockout).

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_TRACKED = 10000;

const state = new Map(); // key -> { failures: number[], lockedUntil: number }

const keyFor = (username) => String(username || '').trim().toLowerCase().slice(0, 100);

const prune = (now) => {
  if (state.size <= MAX_TRACKED) return;
  for (const [key, entry] of state) {
    if (entry.lockedUntil <= now && entry.failures.every((t) => now - t > WINDOW_MS)) state.delete(key);
  }
};

// Returns 0 when the username may try again, otherwise the milliseconds left on the lock.
const lockRemainingMs = (username, now = Date.now()) => {
  const entry = state.get(keyFor(username));
  return entry && entry.lockedUntil > now ? entry.lockedUntil - now : 0;
};

const recordFailure = (username, now = Date.now()) => {
  const key = keyFor(username);
  const entry = state.get(key) || { failures: [], lockedUntil: 0 };
  entry.failures = entry.failures.filter((t) => now - t <= WINDOW_MS);
  entry.failures.push(now);
  if (entry.failures.length >= MAX_FAILURES) {
    entry.lockedUntil = now + LOCK_MS;
    entry.failures = [];
  }
  state.set(key, entry);
  prune(now);
};

const clear = (username) => {
  state.delete(keyFor(username));
};

const lockMessage = (remainingMs) =>
  `Too many failed attempts. Try again in ${Math.max(Math.ceil(remainingMs / 60000), 1)} minute(s).`;

module.exports = { lockRemainingMs, recordFailure, clear, lockMessage, MAX_FAILURES, LOCK_MS };
