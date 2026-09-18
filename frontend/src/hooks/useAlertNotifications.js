import { useCallback, useEffect, useState } from 'react';

const API_BASE_URL = 'http://localhost:5000/api';
const POLL_INTERVAL_MS = 60000;

function buildNotifications(lowStockProducts, expiringProducts) {
  const items = [];

  lowStockProducts.forEach((p) => {
    const outOfStock = p.stock <= 0;
    items.push({
      id: `low-${p.id}`,
      title: outOfStock ? 'Out of Stock' : 'Low Stock Alert',
      message: outOfStock
        ? `${p.name} is out of stock.`
        : `${p.name} — ${p.stock} left (min ${p.minStock}).`,
      type: outOfStock ? 'danger' : 'warning',
      iconKey: outOfStock ? 'outOfStock' : 'lowStock',
      severity: outOfStock ? 0 : 1,
    });
  });

  expiringProducts.forEach((p) => {
    const expired = p.daysUntilExpiry <= 0;
    items.push({
      id: `exp-${p.id}`,
      title: expired ? 'Expired' : 'Expiry Warning',
      message: expired
        ? `${p.name} expired ${Math.abs(p.daysUntilExpiry)} day${Math.abs(p.daysUntilExpiry) === 1 ? '' : 's'} ago.`
        : `${p.name} expires in ${p.daysUntilExpiry} day${p.daysUntilExpiry === 1 ? '' : 's'}.`,
      type: expired ? 'danger' : 'warning',
      iconKey: 'expiry',
      severity: expired ? 0 : 2,
    });
  });

  return items.sort((a, b) => a.severity - b.severity);
}

// Polls the live low-stock / expiry alert endpoints and derives a unified
// notification feed. Shared by every page that renders the notification
// bell so the badge count and the dropdown list never disagree.
export function useAlertNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [readIds, setReadIds] = useState(() => new Set());

  const refresh = useCallback(async () => {
    try {
      const [lowRes, expRes] = await Promise.all([
        fetch(`${API_BASE_URL}/alerts/low-stock`),
        fetch(`${API_BASE_URL}/alerts/expiry`),
      ]);
      if (!lowRes.ok || !expRes.ok) throw new Error('Failed to load alerts');
      const [lowBody, expBody] = await Promise.all([lowRes.json(), expRes.json()]);
      setNotifications(buildNotifications(lowBody.products || [], expBody.products || []));
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const markAllRead = useCallback(() => {
    setReadIds(new Set(notifications.map((n) => n.id)));
  }, [notifications]);

  const unreadCount = notifications.filter((n) => !readIds.has(n.id)).length;

  return { notifications, unreadCount, loading, error, refresh, markAllRead, readIds };
}
