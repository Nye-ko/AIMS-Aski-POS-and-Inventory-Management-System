const bcrypt = require('bcryptjs');
const { prisma } = require('./Product');

const SALT_ROUNDS = 10;
const CREATABLE_ROLES = ['CASHIER', 'SUPERVISOR', 'INVENTORY'];
const APPROVER_ROLES = ['SUPERVISOR', 'ADMIN'];
const PIN_PATTERN = /^\d{4,6}$/;

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

const generateTempPassword = () => {
  return Math.random().toString(36).slice(-5) + Math.random().toString(36).slice(-5);
};

// Rejects a change (demotion / deactivation) that would leave no active admin.
const assertNotLastActiveAdmin = async (target) => {
  if (target.role !== 'ADMIN' || !target.isActive) return;
  const otherActiveAdmins = await prisma.user.count({
    where: { role: 'ADMIN', isActive: true, id: { not: target.id } },
  });
  if (otherActiveAdmins === 0) throw new Error('At least one active administrator must remain.');
};

const UserModel = {
  findAll: async () => {
    const users = await prisma.user.findMany({
      select: publicSelect,
      orderBy: { createdAt: 'desc' },
    });
    return users.map(toPublic);
  },

  create: async ({ fullName, username, password, role }) => {
    if (!fullName || !fullName.trim()) throw new Error('Full name is required.');
    if (!username || !username.trim()) throw new Error('Username is required.');
    if (!password || password.length < 6) throw new Error('Password must be at least 6 characters.');
    if (!CREATABLE_ROLES.includes(role)) throw new Error('Invalid role selected.');

    const existing = await prisma.user.findUnique({ where: { username: username.trim() } });
    if (existing) throw new Error('That username is already taken.');

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const created = await prisma.user.create({
      data: {
        fullName: fullName.trim(),
        username: username.trim(),
        password: hashedPassword,
        role,
      },
      select: publicSelect,
    });
    return toPublic(created);
  },

  updateRole: async (id, role, actingUserId) => {
    if (!CREATABLE_ROLES.includes(role)) throw new Error('Invalid role selected.');
    const user = await prisma.user.findUnique({ where: { id: parseInt(id, 10) } });
    if (!user) throw new Error('User not found.');
    if (user.id === actingUserId) throw new Error('You cannot change your own role.');
    if (user.role !== role) await assertNotLastActiveAdmin(user);

    // Only supervisors and admins can approve at the POS, so a PIN doesn't outlive that role.
    const updated = await prisma.user.update({
      where: { id: parseInt(id, 10) },
      data: { role, ...(APPROVER_ROLES.includes(role) ? {} : { pin: null }) },
      select: publicSelect,
    });
    return toPublic(updated);
  },

  setActive: async (id, isActive, actingUserId) => {
    const user = await prisma.user.findUnique({ where: { id: parseInt(id, 10) } });
    if (!user) throw new Error('User not found.');
    if (!isActive) {
      if (user.id === actingUserId) throw new Error('You cannot deactivate your own account.');
      await assertNotLastActiveAdmin(user);
    }

    const updated = await prisma.user.update({
      where: { id: parseInt(id, 10) },
      data: { isActive: Boolean(isActive) },
      select: publicSelect,
    });
    return toPublic(updated);
  },

  // Sets (or, with pin === null, clears) the supervisor PIN used to approve POS discounts
  // and X-Reading. PINs must be unique among approvers so a PIN identifies exactly one person.
  setPin: async (id, pin) => {
    const userId = parseInt(id, 10);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found.');

    if (pin === null) {
      const cleared = await prisma.user.update({ where: { id: userId }, data: { pin: null }, select: publicSelect });
      return toPublic(cleared);
    }

    if (!APPROVER_ROLES.includes(user.role)) throw new Error('Only supervisors and administrators can have an approval PIN.');
    if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) throw new Error('PIN must be 4 to 6 digits.');

    const others = await prisma.user.findMany({
      where: { pin: { not: null }, id: { not: userId } },
      select: { pin: true },
    });
    for (const other of others) {
      if (await bcrypt.compare(pin, other.pin)) throw new Error('That PIN is already in use. Choose a different one.');
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { pin: await bcrypt.hash(pin, SALT_ROUNDS) },
      select: publicSelect,
    });
    return toPublic(updated);
  },

  // Admin-triggered reset: generates a temporary password, returns it once (not stored in plaintext).
  resetPassword: async (id) => {
    const user = await prisma.user.findUnique({ where: { id: parseInt(id, 10) } });
    if (!user) throw new Error('User not found.');

    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, SALT_ROUNDS);

    await prisma.user.update({
      where: { id: parseInt(id, 10) },
      data: { password: hashedPassword },
    });

    return { tempPassword };
  },
};

module.exports = { UserModel, CREATABLE_ROLES };
