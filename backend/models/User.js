const bcrypt = require('bcryptjs');
const { prisma } = require('./Product');

const SALT_ROUNDS = 10;
const CREATABLE_ROLES = ['CASHIER', 'SUPERVISOR', 'INVENTORY'];

const publicSelect = {
  id: true,
  fullName: true,
  username: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

const generateTempPassword = () => {
  return Math.random().toString(36).slice(-5) + Math.random().toString(36).slice(-5);
};

const UserModel = {
  findAll: async () => {
    return prisma.user.findMany({
      select: publicSelect,
      orderBy: { createdAt: 'desc' },
    });
  },

  create: async ({ fullName, username, password, role }) => {
    if (!fullName || !fullName.trim()) throw new Error('Full name is required.');
    if (!username || !username.trim()) throw new Error('Username is required.');
    if (!password || password.length < 6) throw new Error('Password must be at least 6 characters.');
    if (!CREATABLE_ROLES.includes(role)) throw new Error('Invalid role selected.');

    const existing = await prisma.user.findUnique({ where: { username: username.trim() } });
    if (existing) throw new Error('That username is already taken.');

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    return prisma.user.create({
      data: {
        fullName: fullName.trim(),
        username: username.trim(),
        password: hashedPassword,
        role,
      },
      select: publicSelect,
    });
  },

  updateRole: async (id, role) => {
    if (!CREATABLE_ROLES.includes(role)) throw new Error('Invalid role selected.');
    const user = await prisma.user.findUnique({ where: { id: parseInt(id, 10) } });
    if (!user) throw new Error('User not found.');

    return prisma.user.update({
      where: { id: parseInt(id, 10) },
      data: { role },
      select: publicSelect,
    });
  },

  setActive: async (id, isActive) => {
    const user = await prisma.user.findUnique({ where: { id: parseInt(id, 10) } });
    if (!user) throw new Error('User not found.');

    return prisma.user.update({
      where: { id: parseInt(id, 10) },
      data: { isActive: Boolean(isActive) },
      select: publicSelect,
    });
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
