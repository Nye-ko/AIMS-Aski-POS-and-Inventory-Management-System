import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Plus } from 'lucide-react';

// Names are compared ignoring case and extra spacing, the same rule the backend uses to avoid duplicates.
const supplierKey = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

// One field that is both a dropdown (click to see every supplier) and a text box (type to filter, or to enter a
// supplier that does not exist yet). `value` is { id, text }; `id` is '' while the text matches no supplier.
export default function SupplierCombobox({ value, options, onChange, disabled = false, inputClassName }) {
  const [open, setOpen] = useState(false);
  const [filtering, setFiltering] = useState(false); // false = show the whole list, like a plain dropdown
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef(null);
  const listRef = useRef(null);

  const key = supplierKey(value.text);
  const visible = useMemo(
    () => (filtering && key ? options.filter((o) => supplierKey(o.name).includes(key)) : options),
    [options, key, filtering],
  );
  const isNew = !disabled && key !== '' && !value.id;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    const el = listRef.current && listRef.current.children[highlight];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const choose = (option) => {
    onChange({ id: String(option.id), text: option.name });
    setFiltering(false);
    setOpen(false);
  };

  const handleType = (e) => {
    const text = e.target.value;
    const match = options.find((o) => supplierKey(o.name) === supplierKey(text));
    onChange({ id: match ? String(match.id) : '', text });
    setFiltering(true);
    setHighlight(0);
    setOpen(true);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setHighlight((h) => Math.min(h + 1, Math.max(visible.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      // Enter picks the highlighted supplier while the list is open; otherwise it must not submit the form.
      e.preventDefault();
      if (open && visible[highlight]) choose(visible[highlight]);
      else setOpen(false);
    } else if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation();
        setOpen(false);
      }
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={rootRef}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        value={value.text}
        placeholder="Select or type a supplier..."
        onChange={handleType}
        onFocus={() => {
          setFiltering(false);
          setHighlight(0);
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className={`${inputClassName} pr-9`}
      />
      {!disabled && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Show suppliers"
          onClick={() => {
            setFiltering(false);
            setOpen((o) => !o);
          }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}

      {open && !disabled && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1.5 z-30 max-h-56 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 py-1.5 shadow-xl shadow-slate-950/50"
        >
          {visible.length === 0 && (
            <li className="px-3.5 py-2 text-xs text-slate-400">
              {isNew ? 'No matching supplier.' : 'No suppliers yet.'}
            </li>
          )}
          {visible.map((o, i) => {
            const selected = String(o.id) === String(value.id);
            return (
              <li
                key={o.id}
                role="option"
                aria-selected={selected}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus in the input
                  choose(o);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium cursor-pointer ${
                  i === highlight ? 'bg-blue-600/30 text-white' : 'text-slate-200'
                }`}
              >
                <span className="flex-1 truncate">{o.name}</span>
                {selected && <Check className="w-3.5 h-3.5 text-blue-400 shrink-0" />}
              </li>
            );
          })}
        </ul>
      )}

      {isNew && (
        <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
          <Plus className="w-3 h-3" />
          New supplier &ldquo;{value.text.replace(/\s+/g, ' ').trim()}&rdquo; will be created when you save
        </p>
      )}
    </div>
  );
}
