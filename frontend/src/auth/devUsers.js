// Dev credentials seeded server-side by backend/seeder.js. Login itself goes
// through POST /api/auth/login (see AuthContext.jsx) — this list is just for
// the "try these" hint shown on the login page.
export const DEV_CREDENTIALS_HINT = [
  { username: 'admin', password: 'admin123', role: 'ADMIN' },
  { username: 'supervisor', password: 'supervisor123', role: 'SUPERVISOR' },
  { username: 'cashier', password: 'cashier123', role: 'CASHIER' },
  { username: 'accounting', password: 'accounting123', role: 'ACCOUNTING' },
  { username: 'inventory', password: 'inventory123', role: 'INVENTORY' },
];

// Where each role lands after login.
export const ROLE_HOME = {
  ADMIN:      '/adminDashboard',
  SUPERVISOR: '/adminDashboard',
  ACCOUNTING: '/pages/ims/finance',
  INVENTORY:  '/inventoryList',
  CASHIER:    '/pos',
};
