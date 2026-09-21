const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { prisma } = require('../models/Product');

const JWT_SECRET = process.env.JWT_SECRET;

const TOKEN_TTL_SECONDS = { DISCOUNT: 10 * 60, XREAD: 15 * 60 };
const APPROVER_ROLES = ['SUPERVISOR', 'ADMIN'];
const PIN_PATTERN = /^\d{4,6}$/;

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

// In-memory on purpose: approvals are minutes-long and a restart only forces a re-approval.
const failedAttempts = new Map(); // requesterId -> { count, lockedUntil }
const usedTokenIds = new Map(); // jti -> expiry (ms)

class ApprovalError extends Error {
  constructor(status, message, code = 'APPROVAL_INVALID') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const pruneUsedTokens = () => {
  const now = Date.now();
  for (const [jti, exp] of usedTokenIds) if (exp < now) usedTokenIds.delete(jti);
};

// Exchanges a supervisor PIN for a short-lived approval token bound to the requesting
// cashier and action (and, for discounts, the exact percentage being approved).
const requestApproval = async ({ requester, pin, action, discountPercent }) => {
  if (!JWT_SECRET) throw new ApprovalError(500, 'Server auth is not configured.', 'SERVER_ERROR');
  if (!TOKEN_TTL_SECONDS[action]) throw new ApprovalError(400, 'Unknown approval action.', 'BAD_REQUEST');
  if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) {
    throw new ApprovalError(400, 'Enter the supervisor PIN (4 to 6 digits).', 'BAD_REQUEST');
  }

  let pct = null;
  if (action === 'DISCOUNT') {
    pct = Number(discountPercent);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      throw new ApprovalError(400, 'Discount must be greater than 0% and at most 100%.', 'BAD_REQUEST');
    }
  }

  const state = failedAttempts.get(requester.id);
  if (state && state.lockedUntil > Date.now()) {
    const mins = Math.ceil((state.lockedUntil - Date.now()) / 60000);
    throw new ApprovalError(429, `Too many wrong PINs. Try again in ${mins} minute(s).`, 'LOCKED');
  }

  const approvers = await prisma.user.findMany({
    where: { isActive: true, role: { in: APPROVER_ROLES }, pin: { not: null } },
    select: { id: true, username: true, pin: true },
  });

  let approver = null;
  for (const candidate of approvers) {
    if (await bcrypt.compare(pin, candidate.pin)) {
      approver = candidate;
      break;
    }
  }

  if (!approver) {
    // A recorded lockedUntil here has already expired (checked above), so counting restarts.
    const count = (state && state.lockedUntil === 0 ? state.count : 0) + 1;
    failedAttempts.set(requester.id, {
      count: count >= MAX_FAILED_ATTEMPTS ? 0 : count,
      lockedUntil: count >= MAX_FAILED_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0,
    });
    throw new ApprovalError(403, 'Invalid supervisor PIN.', 'BAD_PIN');
  }

  failedAttempts.delete(requester.id);

  const ttl = TOKEN_TTL_SECONDS[action];
  const token = jwt.sign(
    { typ: 'pos-approval', act: action, appr: approver.id, cashier: requester.id, pct, jti: crypto.randomUUID() },
    JWT_SECRET,
    { expiresIn: ttl },
  );

  return { token, action, approver: { id: approver.id, username: approver.username }, expiresInSeconds: ttl };
};

// Validates a token for a specific use. Does not consume it — call consumeApproval after
// the guarded action succeeds so a failed request doesn't burn the supervisor's approval.
const verifyApproval = async (token, { action, cashierId, discountPercent }) => {
  if (!token) throw new ApprovalError(403, 'Supervisor approval is required.', 'APPROVAL_REQUIRED');

  let claims;
  try {
    claims = jwt.verify(token, JWT_SECRET);
  } catch {
    throw new ApprovalError(403, 'Supervisor approval expired. Please approve again.', 'APPROVAL_INVALID');
  }

  const invalid = () => new ApprovalError(403, 'Supervisor approval is not valid for this action.', 'APPROVAL_INVALID');
  if (claims.typ !== 'pos-approval' || claims.act !== action || claims.cashier !== cashierId) throw invalid();
  if (usedTokenIds.has(claims.jti)) throw invalid();
  if (action === 'DISCOUNT' && Math.abs(Number(claims.pct) - Number(discountPercent)) > 0.005) throw invalid();

  const approver = await prisma.user.findUnique({
    where: { id: claims.appr },
    select: { id: true, isActive: true, role: true, pin: true },
  });
  if (!approver || !approver.isActive || !APPROVER_ROLES.includes(approver.role) || !approver.pin) throw invalid();

  return { approverId: approver.id, jti: claims.jti, expiresAt: claims.exp * 1000 };
};

const consumeApproval = ({ jti, expiresAt }) => {
  pruneUsedTokens();
  usedTokenIds.set(jti, expiresAt);
};

module.exports = { requestApproval, verifyApproval, consumeApproval, ApprovalError, PIN_PATTERN };
