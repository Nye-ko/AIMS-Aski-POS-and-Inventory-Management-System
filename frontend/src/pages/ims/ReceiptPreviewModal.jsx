import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Receipt, Printer, Loader2 } from 'lucide-react';
import { apiFetch } from '../../auth/apiFetch';

import { API_BASE_URL } from '../../config';

const PRINT_MESSAGES = {
  not_configured: 'No receipt printer is set up on the server (RECEIPT_PRINTER_INTERFACE in backend/.env), so nothing was printed.',
  unreachable: "The receipt printer isn't reachable. Check that it's on and connected, then try again.",
};

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Prints just the receipt through the browser's own print dialog, via a throwaway iframe, so it
// works on any printer (and without the thermal printer) without printing the rest of the page.
function browserPrint(receipt) {
  const body = receipt.lines.map((l) => (l.bold ? `<b>${escapeHtml(l.text)}</b>` : escapeHtml(l.text))).join('\n');
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open();
  // An 80mm roll only has ~72mm of printable width. Zero page margins (so the dialog's "Default"
  // margins already mean edge-to-edge) plus a font sized in mm so the 48-character lines come to
  // ~69mm (Courier New is 0.6em per character) keep the right edge from being cut off.
  doc.write(
    `<!doctype html><html><head><title>${escapeHtml(receipt.reference)}</title><style>` +
      '@page{margin:0}html,body{margin:0;padding:0}' +
      `pre{margin:0;padding:2mm 1mm;width:${receipt.width * 0.6 * 2.4}mm;font-family:"Courier New",monospace;` +
      'font-size:2.4mm;line-height:1.25;white-space:pre;color:#000}' +
      `</style></head><body><pre>${body}</pre></body></html>`,
  );
  doc.close();
  const cleanup = () => iframe.remove();
  iframe.contentWindow.onafterprint = cleanup;
  setTimeout(cleanup, 60000);
  iframe.contentWindow.focus();
  iframe.contentWindow.print();
}

const linkClass = 'font-mono text-blue-600 hover:text-blue-800 underline decoration-dotted underline-offset-2 cursor-pointer';

// The reference cell of a stock-ledger row (Subsidiary Ledger, Stock History): a sale's number
// opens its receipt, a void's number opens its void slip, and a sale that was later voided gets a
// VOIDED tag that opens the void. `onOpen` receives { kind, id } for ReceiptPreviewModal.
export function LedgerReference({ movement: m, onOpen }) {
  if (!m.referenceNo) return null;
  let target = null;
  if (m.type === 'SALE' && m.referenceType === 'Transaction' && m.referenceId) target = { kind: 'sale', id: m.referenceId };
  if (m.type === 'VOID' && m.referenceType === 'SaleVoid' && m.referenceId) target = { kind: 'void', id: m.referenceId };
  return (
    <>
      {target ? (
        <button
          type="button"
          onClick={() => onOpen(target)}
          title={target.kind === 'void' ? 'View / print this void slip' : "View / print this sale's receipt"}
          className={linkClass}
        >
          {m.referenceNo}
        </button>
      ) : (
        <span className="font-mono text-slate-700">{m.referenceNo}</span>
      )}
      {m.voidNo && (
        <button
          type="button"
          onClick={() => onOpen({ kind: 'void', id: m.voidId })}
          title={`Voided (${m.voidNo}) — view the void slip`}
          className="ml-2 px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 hover:bg-rose-100 text-[10px] font-bold cursor-pointer"
        >
          VOIDED
        </button>
      )}
    </>
  );
}

const KINDS = {
  sale: { path: 'transactions', title: 'Transaction Receipt' },
  void: { path: 'voids', title: 'Void Receipt' },
};

// A past sale's receipt (kind "sale") or a void slip (kind "void"), exactly as a reprint puts it on
// paper, with buttons to send it to the thermal printer or print it through the browser. Mount
// only while something is selected.
export default function ReceiptPreviewModal({ kind = 'sale', id, onClose }) {
  const { path, title } = KINDS[kind] || KINDS.sale;
  const [receipt, setReceipt] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printStatus, setPrintStatus] = useState(null); // { ok, message }

  useEffect(() => {
    let cancelled = false;
    apiFetch(`${API_BASE_URL}/${path}/${id}/receipt`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Failed to load the receipt.');
        if (!cancelled) setReceipt(body);
      })
      .catch((err) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [path, id]);

  const handleThermalPrint = async () => {
    setIsPrinting(true);
    setPrintStatus(null);
    try {
      const res = await apiFetch(`${API_BASE_URL}/${path}/${id}/reprint`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.printed) setPrintStatus({ ok: true, message: 'Reprint sent to the receipt printer.' });
      else setPrintStatus({ ok: false, message: PRINT_MESSAGES[body.reason] || `Print failed: ${body.error || 'unknown error'}` });
    } catch (err) {
      setPrintStatus({ ok: false, message: `Print failed: ${err.message}` });
    } finally {
      setIsPrinting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-modal-backdrop">
      <div className="font-sans bg-white rounded-2xl shadow-2xl shadow-slate-900/20 w-full max-w-lg max-h-[92vh] border border-slate-200/80 flex flex-col animate-modal-card overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/30">
              <Receipt className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-black text-slate-800 tracking-tight">{title}</h3>
              <p className="text-[11px] text-slate-500 font-semibold font-mono truncate">{receipt?.reference || '…'}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-full transition-colors cursor-pointer" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-slate-100 p-4 sm:p-6">
          {loadError ? (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">{loadError}</div>
          ) : !receipt ? (
            <div className="flex items-center justify-center gap-2 py-16 text-slate-400 text-xs font-semibold">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading receipt…
            </div>
          ) : (
            <div className="overflow-x-auto">
              <pre
                className="mx-auto bg-white shadow-sm border border-slate-200 px-4 py-5 text-[11px] leading-[1.35] text-slate-900 font-mono"
                style={{ width: `calc(${receipt.width}ch + 2rem)` }}
              >
                {receipt.lines.map((l, i) => (
                  <div key={i} className={l.bold ? 'font-bold' : undefined}>
                    {l.text || ' '}
                  </div>
                ))}
              </pre>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 space-y-3">
          {printStatus && (
            <div
              role="status"
              className={`p-3 rounded-xl text-xs font-semibold border ${printStatus.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}
            >
              {printStatus.message}
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={!receipt}
              onClick={() => browserPrint(receipt)}
              className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 transition-colors cursor-pointer"
            >
              Browser print
            </button>
            <button
              type="button"
              disabled={!receipt || isPrinting}
              onClick={handleThermalPrint}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {isPrinting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              {isPrinting ? 'Printing…' : 'Print to thermal printer'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
