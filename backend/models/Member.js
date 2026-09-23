// models/Member.js
const { prisma } = require('./Product');

class MemberError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Flat rate applied at checkout when a sale is tied to a member and no supervisor discount
// was applied (see TransactionModel.createCheckout — the two never stack).
const MEMBER_DISCOUNT_PERCENT = 5;

// Balik Tangkilik points: ₱500 spent (after whatever discount actually applied) earns 1 point,
// but a single sale never earns more than 1 point regardless of how much larger it is — so a
// ₱250 sale earns 0.5, a ₱500 sale earns 1, and a ₱5,000 sale still only earns 1. Points are kept
// as a precise fractional balance (see Member.points) so nothing under ₱500 is ever lost.
const POINTS_PESO_BLOCK = 500;
const computeEarnedPoints = (amountPaid) => {
  const amount = Number(amountPaid);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(Math.min(amount / POINTS_PESO_BLOCK, 1) * 100) / 100;
};

const MemberModel = {
  MEMBER_DISCOUNT_PERCENT,
  POINTS_PESO_BLOCK,
  computeEarnedPoints,

  findAll: async () => {
    return prisma.member.findMany({ orderBy: { createdAt: 'desc' } });
  },

  // Newest first. Small scale (a handful of purchases per member) so this isn't cursor-paginated
  // like the product stock ledger — just capped generously.
  findPointsHistory: async (memberId) => {
    const id = parseInt(memberId, 10);
    if (!id) throw new MemberError(400, 'A valid member id is required.');
    return prisma.memberPointsLedger.findMany({
      where: { memberId: id },
      include: { transaction: { select: { transactionNo: true, totalAmount: true, createdAt: true } } },
      orderBy: { id: 'desc' },
      take: 200,
    });
  },

  // Name or card number, case-insensitive contains — used by the POS lookup box.
  search: async (query) => {
    const q = String(query || '').trim();
    if (!q) return [];
    return prisma.member.findMany({
      where: {
        OR: [{ name: { contains: q, mode: 'insensitive' } }, { cardNumber: { contains: q } }],
      },
      orderBy: { name: 'asc' },
      take: 20,
    });
  },

  findByCardNumber: async (cardNumber) => {
    const member = await prisma.member.findUnique({ where: { cardNumber: String(cardNumber || '').trim() } });
    if (!member) throw new MemberError(404, 'No member found with that card number.');
    return member;
  },

  // Registers a new member and assigns a sequential 6-digit card number derived from the new
  // row's id (e.g. id 1 -> "000001"), so no separate counter/sequence table is needed and card
  // numbers can never collide.
  create: async ({ name, address, phone }) => {
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new MemberError(400, 'Member name is required.');

    return prisma.$transaction(async (tx) => {
      const created = await tx.member.create({
        data: {
          name: cleanName,
          address: address ? String(address).trim() : null,
          phone: phone ? String(phone).trim() : null,
          cardNumber: `TEMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        },
      });
      return tx.member.update({
        where: { id: created.id },
        data: { cardNumber: String(created.id).padStart(6, '0') },
      });
    });
  },
};

MemberModel.MemberError = MemberError;

module.exports = MemberModel;
