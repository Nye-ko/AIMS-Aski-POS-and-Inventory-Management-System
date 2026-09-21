const { prisma } = require('./Product');

const AUDIT_ACTIONS = [
  'USER_CREATED',
  'USER_ROLE_CHANGED',
  'USER_ACTIVATED',
  'USER_DEACTIVATED',
  'USER_PIN_SET',
  'USER_PIN_CLEARED',
  'USER_PASSWORD_RESET',
];

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

const AuditLogModel = {
  // Writes one audit row using the caller's transaction client, so an admin action and its
  // audit record commit (or roll back) together. Never put secrets (passwords, PINs) in `details`.
  record: (tx, { action, actor, target, details }) =>
    tx.auditLog.create({
      data: {
        action,
        actorId: actor.id,
        actorUsername: actor.username,
        targetUserId: target ? target.id : null,
        targetUsername: target ? target.username : null,
        details: details ?? undefined,
      },
    }),

  // Newest first. `before` is the id of the last row already loaded (cursor pagination).
  findAll: async ({ action, targetUserId, actorId, from, to, limit, before } = {}) => {
    const where = {};
    if (action) where.action = action;
    const target = parseInt(targetUserId, 10);
    if (target) where.targetUserId = target;
    const actor = parseInt(actorId, 10);
    if (actor) where.actorId = actor;

    const createdAt = {};
    if (from) {
      const d = new Date(from);
      if (!Number.isNaN(d.getTime())) createdAt.gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (!Number.isNaN(d.getTime())) {
        // A bare YYYY-MM-DD should include that whole day.
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(to))) d.setHours(23, 59, 59, 999);
        createdAt.lte = d;
      }
    }
    if (Object.keys(createdAt).length) where.createdAt = createdAt;

    const cursor = parseInt(before, 10);
    if (cursor) where.id = { lt: cursor };

    const take = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    return prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, take });
  },
};

module.exports = { AuditLogModel, AUDIT_ACTIONS };
