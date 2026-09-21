import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const API_BASE_URL = 'http://localhost:5000/api';
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
  const [session, setSession] = useState(readStoredUser); // { token, id, username, role }
  // Gates sensitive admin screens (User Management) behind a fresh password
  // re-check, on top of the session JWT. Deliberately in-memory only — it
  // resets on page reload and is cleared explicitly on login/logout below.
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);

  useEffect(() => {
    writeStoredUser(session);
  }, [session]);

  const login = useCallback(async (username, password) => {
    const trimmed = (username || '').trim();
    if (!trimmed || !password) {
      throw new Error('Username and password are required.');
    }

    let res;
    try {
      res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: trimmed, password }),
      });
    } catch {
      throw new Error('Could not reach the server. Check your connection and try again.');
    }

    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Invalid username or password.');

    const authed = { token: body.token, ...body.user };
    // Persist synchronously so the first requests of the next page (which read
    // the token from storage) don't race the effect below.
    writeStoredUser(authed);
    setSession(authed);
    setIsAdminAuthenticated(false);
    return authed;
  }, []);

  const logout = useCallback(() => {
    writeStoredUser(null);
    setSession(null);
    setIsAdminAuthenticated(false);
  }, []);

  const verifyAdminPassword = useCallback(
    async (password) => {
      if (!session?.token) throw new Error('Not authenticated.');

      let res;
      try {
        res = await fetch(`${API_BASE_URL}/auth/verify-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
          body: JSON.stringify({ password }),
        });
      } catch {
        throw new Error('Could not reach the server. Check your connection and try again.');
      }

      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Invalid admin password. Access denied.');

      setIsAdminAuthenticated(true);
      return true;
    },
    [session]
  );

  const value = useMemo(() => {
    const user = session
      ? { id: session.id, username: session.username, fullName: session.fullName, role: session.role }
      : null;
    return {
      user,
      token: session?.token || null,
      role: user?.role || null,
      isAuthenticated: !!session,
      isAdminAuthenticated,
      login,
      logout,
      verifyAdminPassword,
    };
  }, [session, isAdminAuthenticated, login, logout, verifyAdminPassword]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
