const STORAGE_KEY = 'aims.auth';

export function getAuthToken() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).token || null : null;
  } catch {
    return null;
  }
}

export function authHeader() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// fetch() with the session token attached. A 401 means the token is missing,
// expired, or its user was deactivated/removed, so the session is dropped and
// the user is sent back to the login page.
export async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...authHeader(), ...(options.headers || {}) },
  });
  if (res.status === 401) {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* non-fatal */
    }
    window.location.replace('/');
  }
  return res;
}
