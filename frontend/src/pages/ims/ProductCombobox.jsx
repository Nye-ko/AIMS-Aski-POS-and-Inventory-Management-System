import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Plus } from 'lucide-react';

const productKey = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

// Light-themed twin of SupplierCombobox.jsx, for picking or typing a product on the Receiving
// Report's "extra items" list. `value` is { id, text }; `id` is '' while the text matches no product
// in `options`, which is what tells the caller this line is a brand-new product to be created.
export default function ProductCombobox({ value, options, onChange, placeholder = 'Select or type a product...' }) {
  const [open, setOpen] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef(null);
  const listRef = useRef(null);

  const key = productKey(value.text);
  const visible = useMemo(
    () => (filtering && key ? options.filter((o) => productKey(o.name).includes(key) || productKey(o.barcode).includes(key)) : options),
    [options, key, filtering],
  );
  const isNew = key !== '' && !value.id;

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
    const match = options.find((o) => productKey(o.name) === productKey(text));
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
        value={value.text}
        placeholder={placeholder}
        onChange={handleType}
        onFocus={() => {
          setFiltering(false);
          setHighlight(0);
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-1.5 pr-7 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-400"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Show products"
        onClick={() => {
          setFiltering(false);
          setOpen((o) => !o);
        }}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
      >
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 z-30 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl shadow-slate-900/10"
        >
          {visible.length === 0 && (
            <li className="px-3 py-2 text-[11px] text-slate-400">{isNew ? 'No matching product.' : 'No products yet.'}</li>
          )}
          {visible.map((o, i) => {
            const selected = String(o.id) === String(value.id);
            return (
              <li
                key={o.id}
                role="option"
                aria-selected={selected}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium cursor-pointer ${
                  i === highlight ? 'bg-emerald-50 text-emerald-800' : 'text-slate-700'
                }`}
              >
                <span className="flex-1 truncate">{o.name}</span>
                {o.barcode && <span className="text-[10px] font-mono text-slate-400">{o.barcode}</span>}
                {selected && <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
              </li>
            );
          })}
        </ul>
      )}

      {isNew && (
        <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
          <Plus className="w-3 h-3" />
          New product — will be created when this report is saved
        </p>
      )}
    </div>
  );
}
