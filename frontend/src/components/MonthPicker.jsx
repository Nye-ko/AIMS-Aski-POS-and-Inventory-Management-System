import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

// Custom month picker (replaces <input type="month">). `value` / `onChange` use "YYYY-MM".
//
// - Popover with year stepper, a 4x3 month grid, and "Last month" / "This month" shortcuts.
// - Click the year in the header to jump through years in a 12-year grid.
// - Months after `max` (default: the current month) are disabled — a report for the future is empty.
// - Rendered in a portal (never clipped), right-aligned to the trigger, flips upward if needed,
//   closes on outside click / Esc / scroll / resize.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PANEL_WIDTH = 288;
const panelWidth = () => (window.innerWidth < 640 ? 232 : PANEL_WIDTH);
const PANEL_GAP = 8;

const pad = (n) => String(n).padStart(2, '0');
const toValue = (year, monthIdx) => `${year}-${pad(monthIdx + 1)}`;
const parseValue = (value) => {
  const [y, m] = String(value || '').split('-').map(Number);
  return { year: y, monthIdx: m - 1 };
};
const nowValue = () => {
  const d = new Date();
  return toValue(d.getFullYear(), d.getMonth());
};
const shiftMonth = (value, delta) => {
  const { year, monthIdx } = parseValue(value);
  const d = new Date(year, monthIdx + delta, 1);
  return toValue(d.getFullYear(), d.getMonth());
};
const label = (value) => {
  const { year, monthIdx } = parseValue(value);
  return new Date(year, monthIdx, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

export default function MonthPicker({ value, onChange, max = nowValue(), className = '' }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('months'); // 'months' | 'years'
  const [viewYear, setViewYear] = useState(() => parseValue(value).year);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  const selected = parseValue(value);
  const today = parseValue(nowValue());
  const maxParsed = parseValue(max);

  const openPicker = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const estimatedHeight = 330;
    const openUp = window.innerHeight - rect.bottom < estimatedHeight && rect.top > window.innerHeight - rect.bottom;
    const left = Math.max(8, Math.min(rect.right - panelWidth(), window.innerWidth - panelWidth() - 8));
    setPos(
      openUp
        ? { left, bottom: window.innerHeight - rect.top + PANEL_GAP }
        : { left, top: rect.bottom + PANEL_GAP }
    );
    setViewYear(selected.year);
    setView('months');
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
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [open]);

  const isMonthDisabled = (year, monthIdx) =>
    year > maxParsed.year || (year === maxParsed.year && monthIdx > maxParsed.monthIdx);

  const pickMonth = (monthIdx) => {
    if (isMonthDisabled(viewYear, monthIdx)) return;
    onChange(toValue(viewYear, monthIdx));
    close();
  };

  const pickValue = (next) => {
    onChange(next);
    close();
  };

  const yearPageStart = Math.floor(viewYear / 12) * 12;
  const canGoNextYear = viewYear < maxParsed.year;
  const canGoNextPage = yearPageStart + 12 <= maxParsed.year;

  const lastMonth = shiftMonth(nowValue(), -1);

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : openPicker())}
        className={`flex items-center gap-2 sm:gap-2.5 px-2.5 py-1.5 sm:px-3.5 sm:py-2.5 bg-white border rounded-xl text-xs sm:text-sm font-semibold text-slate-700 transition-all cursor-pointer focus:outline-none ${
          open
            ? 'border-blue-400 ring-2 ring-blue-500/20 shadow-sm'
            : 'border-slate-200/80 hover:border-blue-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20'
        }`}
      >
        <CalendarDays className="w-4 h-4 text-blue-500 shrink-0" />
        <span className="whitespace-nowrap">{label(value)}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${open ? 'rotate-180 text-blue-500' : ''}`} />
      </button>

      {open && pos && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Choose month"
          className="fixed z-[100] bg-white border border-slate-200 rounded-2xl shadow-xl shadow-slate-900/10 p-2 sm:p-3"
          style={{
            left: pos.left,
            top: pos.top,
            bottom: pos.bottom,
            width: panelWidth(),
            transformOrigin: pos.bottom !== undefined ? 'bottom right' : 'top right',
            animation: 'aimsMonthPickerIn 0.15s ease-out',
          }}
        >
          <style>{`
            @keyframes aimsMonthPickerIn {
              from { opacity: 0; transform: scale(0.96) translateY(-4px); }
              to { opacity: 1; transform: scale(1) translateY(0); }
            }
          `}</style>

          {/* Header: stepper + year label (click to switch to the year grid) */}
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              aria-label={view === 'months' ? 'Previous year' : 'Previous years'}
              onClick={() => setViewYear((y) => (view === 'months' ? y - 1 : y - 12))}
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setView((v) => (v === 'months' ? 'years' : 'months'))}
              className="px-2 sm:px-3 py-0.5 sm:py-1 rounded-lg text-xs sm:text-sm font-extrabold text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              {view === 'months' ? viewYear : `${yearPageStart} – ${yearPageStart + 11}`}
            </button>
            <button
              type="button"
              aria-label={view === 'months' ? 'Next year' : 'Next years'}
              disabled={view === 'months' ? !canGoNextYear : !canGoNextPage}
              onClick={() => setViewYear((y) => (view === 'months' ? y + 1 : y + 12))}
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {view === 'months' ? (
            <div className="grid grid-cols-4 gap-1.5">
              {MONTHS.map((name, idx) => {
                const isSelected = viewYear === selected.year && idx === selected.monthIdx;
                const isCurrent = viewYear === today.year && idx === today.monthIdx;
                const disabled = isMonthDisabled(viewYear, idx);
                return (
                  <button
                    key={name}
                    type="button"
                    disabled={disabled}
                    onClick={() => pickMonth(idx)}
                    className={`relative py-1.5 sm:py-2.5 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-bold transition-all ${
                      isSelected
                        ? 'bg-[#0B132B] text-white shadow-md shadow-slate-900/25'
                        : disabled
                          ? 'text-slate-300 cursor-not-allowed'
                          : 'text-slate-700 hover:bg-blue-50 hover:text-blue-700 cursor-pointer'
                    }`}
                  >
                    {name}
                    {isCurrent && (
                      <span className={`absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${isSelected ? 'bg-cyan-300' : 'bg-blue-500'}`} />
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {Array.from({ length: 12 }, (_, i) => yearPageStart + i).map((year) => {
                const isSelected = year === selected.year;
                const disabled = year > maxParsed.year;
                return (
                  <button
                    key={year}
                    type="button"
                    disabled={disabled}
                    onClick={() => { setViewYear(year); setView('months'); }}
                    className={`py-1.5 sm:py-2.5 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-bold transition-all ${
                      isSelected
                        ? 'bg-[#0B132B] text-white shadow-md shadow-slate-900/25'
                        : disabled
                          ? 'text-slate-300 cursor-not-allowed'
                          : year === today.year
                            ? 'text-blue-600 bg-blue-50 hover:bg-blue-100 cursor-pointer'
                            : 'text-slate-700 hover:bg-blue-50 hover:text-blue-700 cursor-pointer'
                    }`}
                  >
                    {year}
                  </button>
                );
              })}
            </div>
          )}

          {/* Shortcuts */}
          <div className="flex items-center justify-between gap-2 mt-2 pt-2 sm:mt-3 sm:pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => pickValue(lastMonth)}
              className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-[10px] sm:text-[11px] font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer"
            >
              Last month
            </button>
            <button
              type="button"
              onClick={() => pickValue(nowValue())}
              className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-[10px] sm:text-[11px] font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors cursor-pointer"
            >
              This month
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
