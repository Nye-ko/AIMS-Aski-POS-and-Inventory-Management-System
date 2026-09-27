import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';

// Custom date picker (replaces <input type="date">). `value` / `onChange` use "YYYY-MM-DD"
// ('' when empty), so it is a drop-in swap. `min` / `max` are "YYYY-MM-DD" bounds.
//
// - Popover with month stepper, a 6-week day grid (leading/trailing days dimmed), and
//   "Clear" / "Today" shortcuts. Click the month/year title to jump through months and years.
// - Days outside min/max are disabled.
// - Rendered in a portal (never clipped), flips upward if there is no room below,
//   closes on outside click / Esc / scroll / resize.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const PANEL_WIDTH = 296;
const panelWidth = () => (window.innerWidth < 640 ? 252 : PANEL_WIDTH);
const PANEL_GAP = 8;

const pad = (n) => String(n).padStart(2, '0');
const toValue = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parseValue = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
};
const todayValue = () => {
  const d = new Date();
  return toValue(d.getFullYear(), d.getMonth(), d.getDate());
};
const formatLabel = (value) => {
  const p = parseValue(value);
  if (!p) return '';
  return new Date(p.year, p.month, p.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = 'Select date',
  clearable = false,
  className = '',
  ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('days'); // 'days' | 'months' | 'years'
  const [cursor, setCursor] = useState(() => {
    const p = parseValue(value) || parseValue(todayValue());
    return { year: p.year, month: p.month };
  });
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  const selected = parseValue(value);
  const today = todayValue();

  const openPicker = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const estimatedHeight = 380;
    const openUp = window.innerHeight - rect.bottom < estimatedHeight && rect.top > window.innerHeight - rect.bottom;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - panelWidth() - 8));
    setPos(openUp ? { left, bottom: window.innerHeight - rect.top + PANEL_GAP } : { left, top: rect.bottom + PANEL_GAP });
    const p = parseValue(value) || parseValue(clampToRange(today));
    setCursor({ year: p.year, month: p.month });
    setView('days');
    setOpen(true);
  };

  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return undefined;
    const handleDown = (e) => {
      if (triggerRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const handleScroll = (e) => {
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const handleResize = () => setOpen(false);
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey, true);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey, true);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [open]);

  const clampToRange = (v) => {
    if (min && v < min) return min;
    if (max && v > max) return max;
    return v;
  };
  const isDisabled = (v) => Boolean((min && v < min) || (max && v > max));

  const pickDay = (v) => {
    if (isDisabled(v)) return;
    onChange(v);
    close();
  };

  const stepMonth = (delta) => {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  // 6 rows x 7 columns starting on the Sunday on/before the 1st.
  const firstOfMonth = new Date(cursor.year, cursor.month, 1);
  const gridStart = new Date(cursor.year, cursor.month, 1 - firstOfMonth.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    return { v: toValue(d.getFullYear(), d.getMonth(), d.getDate()), day: d.getDate(), inMonth: d.getMonth() === cursor.month };
  });

  const yearPageStart = Math.floor(cursor.year / 12) * 12;
  const monthTitle = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const minParsed = parseValue(min);
  const maxParsed = parseValue(max);
  const monthOutOfRange = (year, month) =>
    (minParsed && (year < minParsed.year || (year === minParsed.year && month < minParsed.month))) ||
    (maxParsed && (year > maxParsed.year || (year === maxParsed.year && month > maxParsed.month)));

  const navBtn = 'w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent';

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : openPicker())}
        className={`flex w-full min-w-[128px] sm:min-w-[158px] items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 bg-white border rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-semibold transition-all cursor-pointer focus:outline-none ${
          open
            ? 'border-blue-400 ring-2 ring-blue-500/20 shadow-sm'
            : 'border-slate-200 hover:border-blue-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20'
        }`}
      >
        <CalendarDays className="w-4 h-4 text-blue-500 shrink-0" />
        <span className={`flex-1 text-left whitespace-nowrap ${value ? 'text-slate-700' : 'text-slate-400 font-medium'}`}>
          {value ? formatLabel(value) : placeholder}
        </span>
      </button>

      {open && pos && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Choose date"
          className="fixed z-[100] bg-white border border-slate-200 rounded-2xl shadow-xl shadow-slate-900/10 p-2 sm:p-3"
          style={{
            left: pos.left,
            top: pos.top,
            bottom: pos.bottom,
            width: panelWidth(),
            transformOrigin: pos.bottom !== undefined ? 'bottom left' : 'top left',
            animation: 'aimsDatePickerIn 0.15s ease-out',
          }}
        >
          <style>{`
            @keyframes aimsDatePickerIn {
              from { opacity: 0; transform: scale(0.96) translateY(-4px); }
              to { opacity: 1; transform: scale(1) translateY(0); }
            }
          `}</style>

          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              aria-label="Previous"
              onClick={() => (view === 'days' ? stepMonth(-1) : setCursor((c) => ({ ...c, year: c.year - (view === 'years' ? 12 : 1) })))}
              className={navBtn}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setView((v) => (v === 'days' ? 'months' : v === 'months' ? 'years' : 'days'))}
              className="px-2 sm:px-3 py-0.5 sm:py-1 rounded-lg text-xs sm:text-sm font-extrabold text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              {view === 'days' ? monthTitle : view === 'months' ? cursor.year : `${yearPageStart} – ${yearPageStart + 11}`}
            </button>
            <button
              type="button"
              aria-label="Next"
              onClick={() => (view === 'days' ? stepMonth(1) : setCursor((c) => ({ ...c, year: c.year + (view === 'years' ? 12 : 1) })))}
              className={navBtn}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {view === 'days' && (
            <>
              <div className="grid grid-cols-7 mb-1">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="h-6 sm:h-8 flex items-center justify-center text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    {w}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-y-0.5">
                {cells.map((c) => {
                  const isSelected = value === c.v;
                  const isToday = c.v === today;
                  const disabled = isDisabled(c.v);
                  return (
                    <button
                      key={c.v}
                      type="button"
                      disabled={disabled}
                      onClick={() => pickDay(c.v)}
                      className={`relative mx-auto w-8 h-8 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-bold transition-all ${
                        isSelected
                          ? 'bg-[#0B132B] text-white shadow-md shadow-slate-900/25'
                          : disabled
                            ? 'text-slate-300 cursor-not-allowed'
                            : c.inMonth
                              ? 'text-slate-700 hover:bg-blue-50 hover:text-blue-700 cursor-pointer'
                              : 'text-slate-300 hover:bg-slate-50 cursor-pointer'
                      }`}
                    >
                      {c.day}
                      {isToday && (
                        <span className={`absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${isSelected ? 'bg-cyan-300' : 'bg-blue-500'}`} />
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {view === 'months' && (
            <div className="grid grid-cols-4 gap-1.5">
              {MONTHS.map((name, idx) => {
                const disabled = monthOutOfRange(cursor.year, idx);
                const isSelected = selected && selected.year === cursor.year && selected.month === idx;
                return (
                  <button
                    key={name}
                    type="button"
                    disabled={disabled}
                    onClick={() => { setCursor((c) => ({ ...c, month: idx })); setView('days'); }}
                    className={`py-1.5 sm:py-2.5 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-bold transition-all ${
                      isSelected
                        ? 'bg-[#0B132B] text-white'
                        : disabled
                          ? 'text-slate-300 cursor-not-allowed'
                          : 'text-slate-700 hover:bg-blue-50 hover:text-blue-700 cursor-pointer'
                    }`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          )}

          {view === 'years' && (
            <div className="grid grid-cols-4 gap-1.5">
              {Array.from({ length: 12 }, (_, i) => yearPageStart + i).map((year) => {
                const disabled = (minParsed && year < minParsed.year) || (maxParsed && year > maxParsed.year);
                const isSelected = selected && selected.year === year;
                return (
                  <button
                    key={year}
                    type="button"
                    disabled={disabled}
                    onClick={() => { setCursor((c) => ({ ...c, year })); setView('months'); }}
                    className={`py-1.5 sm:py-2.5 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-bold transition-all ${
                      isSelected
                        ? 'bg-[#0B132B] text-white'
                        : disabled
                          ? 'text-slate-300 cursor-not-allowed'
                          : 'text-slate-700 hover:bg-blue-50 hover:text-blue-700 cursor-pointer'
                    }`}
                  >
                    {year}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 mt-2 pt-2 sm:mt-3 sm:pt-3 border-t border-slate-100">
            {clearable ? (
              <button
                type="button"
                onClick={() => { onChange(''); close(); }}
                className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-[10px] sm:text-[11px] font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            ) : <span />}
            <button
              type="button"
              disabled={isDisabled(today)}
              onClick={() => pickDay(today)}
              className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-[10px] sm:text-[11px] font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Today
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
