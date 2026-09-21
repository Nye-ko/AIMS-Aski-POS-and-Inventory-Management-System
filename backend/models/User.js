const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { prisma } = require('./Product');
const { AuditLogModel } = require('./AuditLog');
const loginThrottle = require('../services/loginThrottle');

const SALT_ROUNDS = 10;
const CREATABLE_ROLES = ['CASHIER', 'SUPERVISOR', 'INVENTORY', 'ACCOUNTING'];
const APPROVER_ROLES = ['SUPERVISOR', 'ADMIN'];
const PIN_PATTERN = /^\d{4,6}$/;
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 72; // bcrypt ignores everything past 72 bytes

// Failures the API should report with a specific status (429 for a locked account).
class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const publicSelect = {
  id: true,
  fullName: true,
  username: true,
  role: true,
  isActive: true,
  pin: true,
  createdAt: true,
  updatedAt: true,
};

// Never expose the stored PIN hash — only whether one is set.
const toPublic = (user) => {
  if (!user) return user;
  const { pin, ...rest } = user;
  return { ...rest, hasPin: !!pin };
};

// Unambiguous characters only (no 0/O, 1/l/I) so a temp password can be read out or typed easily.
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const generateTempPassword = () =>
  Array.from({ length: 12 }, () => TEMP_PASSWORD_ALPHABET[crypto.randomInt(TEMP_PASSWORD_ALPHABET.length)]).join('');

const assertValidNewPassword = (password) => {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new UserError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_LENGTH) {
    throw new UserError(`Password must be at most ${MAX_PASSWORD_LENGTH} bytes long.`);
  }
};

// Rejects a change (demotion / deactivation) that would leave no active admin.
const assertNotLastActiveAdmin = async (target) => {
  if (target.role !== 'ADMIN' || !target.isActive) return;
  const otherActiveAdmins = await prisma.user.count({
    where: { role: 'ADMIN', isActive: true, id: { not: target.id } },
  });
  if (otherActiveAdmins === 0) throw new UserError('At least one active administrator must remain.');
};

const loadUser = async (id) => {
  const user = await prisma.user.findUnique({ where: { id: parseInt(id, 10) } });
  if (!user) throw new UserError('User not found.');
  return user;
};

// `actor` is the authenticated admin performing the action: { id, username }.
const UserModel = {
  findAll: async () => {
    const users = await prisma.user.findMany({
      select: publicSelect,
      orderBy: { createdAt: 'desc' },
    });
    return users.map(toPublic);
  },

  create: async ({ fullName, username, password, role }, actor) => {
    if (!fullName || !fullName.trim()) throw new UserError('Full name is required.');
    if (!username || !username.trim()) throw new UserError('Username is required.');
    assertValidNewPassword(password);
    if (!CREATABLE_ROLES.includes(role)) throw new UserError('Invalid role selected.');

    const existing = await prisma.user.findUnique({ where: { username: username.trim() } });
    if (existing) throw new UserError('That username is already taken.');

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    return prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          fullName: fullName.trim(),
          username: username.trim(),
          password: hashedPassword,
          role,
        },
        select: publicSelect,
      });
      await AuditLogModel.record(tx, { action: 'USER_CREATED', actor, target: created, details: { role } });
      return toPublic(created);
    });
  },

  updateRole: async (id, role, actor) => {
    if (!CREATABLE_ROLES.includes(role)) throw new UserError('Invalid role selected.');
    const user = await loadUser(id);
    if (user.id === actor.id) throw new UserError('You cannot change your own role.');
    if (user.role !== role) await assertNotLastActiveAdmin(user);

    return prisma.$transaction(async (tx) => {
      // Only supervisors and admins can approve at the POS, so a PIN doesn't outlive that role.
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { role, ...(APPROVER_ROLES.includes(role) ? {} : { pin: null }) },
        select: publicSelect,
      });
      if (user.role !== role) {
        await AuditLogModel.record(tx, {
          action: 'USER_ROLE_CHANGED',
          actor,
          target: updated,
          details: { from: user.role, to: role },
        });
      }
      return toPublic(updated);
    });
  },

  setActive: async (id, isActive, actor) => {
    const user = await loadUser(id);
    const next = Boolean(isActive);
    if (!next) {
      if (user.id === actor.id) throw new UserError('You cannot deactivate your own account.');
      await assertNotLastActiveAdmin(user);
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { isActive: next },
        select: publicSelect,
      });
      if (user.isActive !== next) {
        await AuditLogModel.record(tx, {
          action: next ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
          actor,
          target: updated,
        });
      }
      return toPublic(updated);
    });
  },

  // Sets (or, with pin === null, clears) the supervisor PIN used to approve POS discounts
  // and X-Reading. PINs must be unique among approvers so a PIN identifies exactly one person.
  setPin: async (id, pin, actor) => {
    const user = await loadUser(id);

    if (pin === null) {
      return prisma.$transaction(async (tx) => {
        const cleared = await tx.user.update({ where: { id: user.id }, data: { pin: null }, select: publicSelect });
        if (user.pin) await AuditLogModel.record(tx, { action: 'USER_PIN_CLEARED', actor, target: cleared });
        return toPublic(cleared);
      });
    }

    if (!APPROVER_ROLES.includes(user.role)) throw new UserError('Only supervisors and administrators can have an approval PIN.');
    if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) throw new UserError('PIN must be 4 to 6 digits.');

    const others = await prisma.user.findMany({
      where: { pin: { not: null }, id: { not: user.id } },
      select: { pin: true },
    });
    for (const other of others) {
      if (await bcrypt.compare(pin, other.pin)) throw new UserError('That PIN is already in use. Choose a different one.');
    }

    const hashedPin = await bcrypt.hash(pin, SALT_ROUNDS);
    return prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: user.id }, data: { pin: hashedPin }, select: publicSelect });
      await AuditLogModel.record(tx, { action: 'USER_PIN_SET', actor, target: updated });
      return toPublic(updated);
    });
  },

  // Admin-triggered reset: generates a temporary password, returns it once (not stored in plaintext).
  // Also lifts any failed-login lockout so the user can sign in with it right away.
  resetPassword: async (id, actor) => {
    const user = await loadUser(id);

    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, SALT_ROUNDS);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { password: hashedPassword } });
      await AuditLogModel.record(tx, { action: 'USER_PASSWORD_RESET', actor, target: user });
    });
    loginThrottle.clear(user.username);

    return { tempPassword };
  },

  // Self-service: the signed-in user changes their own password after proving the current one.
  // Wrong attempts count toward the same lockout as login, so a stolen token can't be used to
  // brute-force the current password.
  changePassword: async (userId, currentPassword, newPassword) => {
    const user = await loadUser(userId);

    const remaining = loginThrottle.lockRemainingMs(user.username);
    if (remaining > 0) throw new UserError(loginThrottle.lockMessage(remaining), 429);

    if (typeof currentPassword !== 'string' || !currentPassword) throw new UserError('Current password is required.');
    assertValidNewPassword(newPassword);

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      loginThrottle.recordFailure(user.username);
      throw new UserError('Current password is incorrect.');
    }
    loginThrottle.clear(user.username);

    if (currentPassword === newPassword) throw new UserError('New password must be different from the current one.');

    await prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash(newPassword, SALT_ROUNDS) } });
  },
};

module.exports = { UserModel, UserError, CREATABLE_ROLES };
