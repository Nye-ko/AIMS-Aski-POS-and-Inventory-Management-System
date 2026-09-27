import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

// Shared dropdown used in place of every native <select>.
//
//   <Dropdown value={v} onChange={(next) => ...} options={[{ value, label, hint?, icon?, chip?, disabled? }]} />
//
// - The option panel is rendered in a portal with fixed positioning, so it is never clipped by a
//   modal's or card's overflow, and it flips upward when there is no room below.
// - Opens with a short fade/scale animation; the chevron rotates; the selected option gets a check.
// - Keyboard: Arrow keys / Home / End move, Enter or Space picks, Esc / Tab closes.
// - `required` keeps native form validation working via a visually-hidden input.
// - `icon` (a lucide component) + `chip` (Tailwind classes) render a coloured icon chip per option.

const SIZE_CLASSES = {
  md: 'px-3.5 py-2.5 text-xs',
  sm: 'px-2.5 py-1.5 text-xs',
};

// Option-panel colour schemes. 'dark' matches the supplier combobox on the purchase order form.
const PANEL_TONES = {
  light: {
    panel: 'bg-white border-slate-200 rounded-2xl shadow-xl shadow-slate-900/10 p-1.5',
    option: 'rounded-xl px-2 py-1.5',
    active: 'bg-slate-100',
    text: 'text-slate-600',
    selectedText: 'text-blue-700',
    hint: 'text-slate-400',
    check: 'text-blue-600',
  },
  dark: {
    panel: 'bg-slate-900 border-slate-700 rounded-xl shadow-xl shadow-slate-950/50 py-1.5',
    option: 'px-3.5 py-2',
    active: 'bg-blue-600/30',
    text: 'text-slate-200',
    selectedText: 'text-white',
    hint: 'text-slate-400',
    check: 'text-blue-400',
  },
};

const PANEL_GAP = 6;
const PANEL_MAX_HEIGHT = 280;

export default function Dropdown({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled = false,
  required = false,
  size = 'md',
  panelTone = 'light',
  className = '',
  ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [pos, setPos] = useState(null); // { left, width, top?, bottom?, maxHeight }
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const itemRefs = useRef([]);

  const tone = PANEL_TONES[panelTone] || PANEL_TONES.light;
  const selectedIdx = options.findIndex((o) => o.value === value);
  const selected = selectedIdx >= 0 ? options[selectedIdx] : null;
  const SelectedIcon = selected?.icon;

  const isEnabled = (idx) => options[idx] && !options[idx].disabled;

  const closeMenu = () => setOpen(false);

  const openMenu = () => {
    if (disabled || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - PANEL_GAP - 8;
    const spaceAbove = rect.top - PANEL_GAP - 8;
    const openUp = spaceBelow < 200 && spaceAbove > spaceBelow;
    const width = Math.max(rect.width, 176);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setPos(
      openUp
        ? { left, width, bottom: window.innerHeight - rect.top + PANEL_GAP, maxHeight: Math.min(PANEL_MAX_HEIGHT, spaceAbove) }
        : { left, width, top: rect.bottom + PANEL_GAP, maxHeight: Math.min(PANEL_MAX_HEIGHT, spaceBelow) }
    );
    setActiveIdx(selectedIdx >= 0 ? selectedIdx : Math.max(0, options.findIndex((o) => !o.disabled)));
    setOpen(true);
  };

  const pick = (idx) => {
    if (!isEnabled(idx)) return;
    onChange(options[idx].value);
    closeMenu();
  };

  // Close on outside click, window resize, or scrolling anything other than the panel itself
  // (the fixed panel would otherwise drift away from its trigger).
  useEffect(() => {
    if (!open) return undefined;
    const handleDown = (e) => {
      if (triggerRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const handleScroll = (e) => {
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const handleResize = () => setOpen(false);
    document.addEventListener('mousedown', handleDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [open]);

  // Keep the keyboard-highlighted option visible.
  useEffect(() => {
    if (open) itemRefs.current[activeIdx]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIdx]);

  const move = (dir) => {
    setActiveIdx((cur) => {
      let next = cur;
      for (let step = 0; step < options.length; step += 1) {
        next = (next + dir + options.length) % options.length;
        if (isEnabled(next)) return next;
      }
      return cur;
    });
  };

  const handleKeyDown = (e) => {
    if (disabled) return;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Home') { e.preventDefault(); setActiveIdx(options.findIndex((o) => !o.disabled)); }
    else if (e.key === 'End') {
      e.preventDefault();
      for (let i = options.length - 1; i >= 0; i -= 1) {
        if (isEnabled(i)) { setActiveIdx(i); break; }
      }
    }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(activeIdx); }
    else if (e.key === 'Escape') {
      // Don't let an enclosing modal treat this Escape as "close the modal".
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    }
    else if (e.key === 'Tab') closeMenu();
  };

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleKeyDown}
        className={`w-full flex items-center gap-2 bg-white border rounded-xl font-semibold text-left transition-all focus:outline-none ${SIZE_CLASSES[size] || SIZE_CLASSES.md} ${
          open
            ? 'border-blue-400 ring-2 ring-blue-500/20 shadow-sm'
            : 'border-slate-200 hover:border-blue-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20'
        } ${disabled ? 'opacity-60 cursor-not-allowed bg-slate-50 hover:border-slate-200' : 'cursor-pointer'}`}
      >
        {SelectedIcon && (
          <span className={`w-6 h-6 -my-1 rounded-lg flex items-center justify-center shrink-0 ${selected.chip || 'bg-slate-100 text-slate-500'}`}>
            <SelectedIcon className="w-3.5 h-3.5" />
          </span>
        )}
        <span className={`flex-1 truncate ${selected ? 'text-slate-700' : 'text-slate-400 font-medium'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${open ? 'rotate-180 text-blue-500' : 'text-slate-400'}`} />
      </button>

      {required && (
        <input
          tabIndex={-1}
          aria-hidden="true"
          required
          value={value ?? ''}
          onChange={() => {}}
          className="absolute bottom-0 left-1/2 w-px h-px opacity-0 pointer-events-none"
        />
      )}

      {open && pos && createPortal(
        <div
          ref={panelRef}
          role="listbox"
          // Keep focus on the trigger so keyboard navigation keeps working after a click.
          onMouseDown={(e) => e.preventDefault()}
          className={`fixed z-[100] border overflow-y-auto ${tone.panel}`}
          style={{
            left: pos.left,
            width: pos.width,
            top: pos.top,
            bottom: pos.bottom,
            maxHeight: pos.maxHeight,
            transformOrigin: pos.bottom !== undefined ? 'bottom' : 'top',
            animation: 'aimsDropdownIn 0.15s ease-out',
          }}
        >
          <style>{`
            @keyframes aimsDropdownIn {
              from { opacity: 0; transform: scale(0.96) translateY(-4px); }
              to { opacity: 1; transform: scale(1) translateY(0); }
            }
          `}</style>
          {options.map((opt, idx) => {
            const Icon = opt.icon;
            const isSelected = idx === selectedIdx;
            return (
              <button
                key={String(opt.value)}
                ref={(el) => { itemRefs.current[idx] = el; }}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={opt.disabled}
                tabIndex={-1}
                onMouseEnter={() => !opt.disabled && setActiveIdx(idx)}
                onClick={() => pick(idx)}
                className={`w-full flex items-center gap-2.5 ${tone.option} text-xs font-semibold text-left transition-colors ${
                  opt.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                } ${idx === activeIdx && !opt.disabled ? tone.active : ''} ${isSelected ? tone.selectedText : tone.text}`}
              >
                {Icon && (
                  <span className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${opt.chip || 'bg-slate-100 text-slate-500'}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                )}
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{opt.label}</span>
                  {opt.hint && <span className={`block text-[10px] font-medium ${tone.hint} truncate`}>{opt.hint}</span>}
                </span>
                {isSelected && <Check className={`w-3.5 h-3.5 shrink-0 ${tone.check}`} />}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}
