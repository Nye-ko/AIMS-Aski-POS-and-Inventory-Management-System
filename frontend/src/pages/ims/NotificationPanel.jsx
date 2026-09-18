import { AlertTriangle, PackageX, Clock, Loader2, X } from 'lucide-react';

const ICONS = {
  lowStock: AlertTriangle,
  outOfStock: PackageX,
  expiry: Clock,
};

export default function NotificationPanel({ isOpen, onClose, notifications, loading, error, unreadCount, markAllRead }) {
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop overlay to close dropdown on click outside */}
      <div
        className="fixed inset-0 z-40 bg-transparent"
        onClick={onClose}
      />

      {/* contAiner */}
      <div className="absolute right-0 top-14 z-50 w-80 sm:w-96 rounded-3xl bg-white border border-white/80 p-5 shadow-2xl shadow-blue-900/20 transition-all duration-300">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200/60 pb-3">
          <div className="flex items-center gap-2">
            <h3 className="font-extrabold text-slate-800 text-base">Notifications</h3>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-blue-600/10 text-blue-600 text-xs font-bold">
                {unreadCount} New
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100/60 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* notif List */}
        <div className="mt-3 space-y-2.5 max-h-[320px] overflow-y-auto pr-1 navy-scrollbar">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : error ? (
            <p className="text-xs text-rose-600 font-semibold text-center py-6">{error}</p>
          ) : notifications.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-6">You're all caught up — no active alerts.</p>
          ) : (
            notifications.map((notif) => {
              const Icon = ICONS[notif.iconKey] || AlertTriangle;

              const badgeStyles = {
                warning: 'bg-amber-500/15 text-amber-700 border-amber-300/50',
                danger: 'bg-rose-500/15 text-rose-700 border-rose-300/50',
              }[notif.type];

              return (
                <div
                  key={notif.id}
                  className="flex items-start gap-3 p-3 rounded-2xl bg-white/50 border border-white/60 hover:bg-white/80 transition cursor-default"
                >
                  <div className={`p-2 rounded-xl border ${badgeStyles} shrink-0 mt-0.5`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-800 truncate">{notif.title}</p>
                    <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{notif.message}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="mt-3 pt-3 border-t border-slate-200/60 text-center">
          <button
            onClick={markAllRead}
            disabled={notifications.length === 0}
            className="text-xs font-bold text-blue-600 hover:text-blue-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Mark all as read
          </button>
        </div>
      </div>
    </>
  );
}
