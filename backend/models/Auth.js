// models/Auth.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { prisma } = require('./Product');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = '12h';

if (!JWT_SECRET) {
  console.warn('[auth] JWT_SECRET is not set in the environment — login will fail until it is configured in backend/.env.');
}

const AuthModel = {
  login: async (username, password) => {
    if (!username || !password) {
      throw new Error('Username and password are required.');
    }
    if (!JWT_SECRET) {
      throw new Error('Server auth is not configured (missing JWT_SECRET).');
    }

    const user = await prisma.user.findUnique({ where: { username: username.trim() } });
    if (!user) throw new Error('Invalid username or password.');

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new Error('Invalid username or password.');

    if (!user.isActive) throw new Error('This account has been deactivated. Contact an administrator.');

    const payload = { id: user.id, username: user.username, role: user.role };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    return { token, user: payload };
  },

  // Re-checks the caller's own password against their stored hash. Used to gate
  // sensitive admin-only screens (e.g. User Management) behind a fresh password
  // prompt even though their session JWT is already valid.
  verifyPassword: async (userId, password) => {
    if (!password) throw new Error('Password is required.');

    const user = await prisma.user.findUnique({ where: { id: parseInt(userId, 10) } });
    if (!user) throw new Error('Invalid admin password. Access denied.');

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new Error('Invalid admin password. Access denied.');

    if (!user.isActive) throw new Error('This account has been deactivated. Contact an administrator.');

    return true;
  },
};

// Verifies the "Authorization: Bearer <token>" header and attaches the decoded
// payload to req.user. Not yet applied to existing routes — see CLAUDE.md/audit
// notes; this is infrastructure for the next phase of wiring real attribution.
function authenticateToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing authentication token.' });
  if (!JWT_SECRET) return res.status(500).json({ error: 'Server auth is not configured.' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// Thrown by model .create() calls when a JWT verifies fine but the user id it
// carries no longer exists (e.g. the users table was reseeded after the
// token was issued). Route handlers map this to 401 so the frontend can
// force a re-login instead of showing a generic 500.
const STALE_SESSION_ERROR = 'Authenticated user no longer exists.';

module.exports = { AuthModel, authenticateToken, STALE_SESSION_ERROR };
