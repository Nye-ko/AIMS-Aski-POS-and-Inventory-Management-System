// Single source of truth for the backend's origin — see .env.example. Falls back to localhost:5000
// for local dev (today's behavior, unchanged). Set VITE_API_BASE_URL to reach the backend through a
// different host/port, e.g. a VS Code port-forwarded or tunneled URL when testing from another
// device, or a real deployment's backend URL.
export const SERVER_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';
export const API_BASE_URL = `${SERVER_URL}/api`;
