import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEV_USERS, DEV_SUPERVISOR_PIN } from './devUsers';

const STORAGE_KEY = 'aims.auth';

// eslint-disable-next-line react-refresh/only-export-components
const AuthContext = createContext(null);

function readStoredUser() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredUser(user) {
  try {
    if (user) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage may be disabled — non-fatal */
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredUser);

  useEffect(() => {
    writeStoredUser(user);
  }, [user]);

  const login = useCallback((username, password) => {
    const trimmed = (username || '').trim();
    if (!trimmed || !password) {
      throw new Error('Username and password are required.');
    }
    const match = DEV_USERS.find(
      (u) => u.username.toLowerCase() === trimmed.toLowerCase() && u.password === password,
    );
    if (!match) throw new Error('Invalid username or password.');
    const authed = { id: match.id, username: match.username, role: match.role };
    setUser(authed);
    return authed;
  }, []);

  const logout = useCallback(() => setUser(null), []);

  const authorizeSupervisor = useCallback((pin) => pin === DEV_SUPERVISOR_PIN, []);

  const value = useMemo(
    () => ({
      user,
      role: user?.role || null,
      isAuthenticated: !!user,
      login,
      logout,
      authorizeSupervisor,
    }),
    [user, login, logout, authorizeSupervisor],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
