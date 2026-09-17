// Dev-mode role table used by the login page. Ships until the backend
// implements POST /api/auth/login. Not for production.

export const DEV_USERS = [
  { id: 1, username: 'admin',      password: 'admin123',      role: 'ADMIN' },
  { id: 2, username: 'supervisor', password: 'supervisor123', role: 'SUPERVISOR' },
  { id: 3, username: 'cashier',    password: 'cashier123',    role: 'CASHIER' },
  { id: 4, username: 'accounting', password: 'accounting123', role: 'ACCOUNTING' },
  { id: 5, username: 'inventory',  password: 'inventory123',  role: 'INVENTORY' },
];

// Password supervisors type at the POS to authorize a discount.
export const DEV_SUPERVISOR_PIN = 'super123';

// Where each role lands after login.
export const ROLE_HOME = {
  ADMIN:      '/adminDashboard',
  SUPERVISOR: '/adminDashboard',
  ACCOUNTING: '/pages/ims/finance',
  INVENTORY:  '/inventoryList',
  CASHIER:    '/pos',
};
