import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ClipboardCheck, Loader2, Download } from 'lucide-react';

const API_BASE_URL = 'http://localhost:5000/api';

async function downloadReceivingReportFile(receivingReport) {
  const res = await fetch(`${API_BASE_URL}/receiving-reports/${receivingReport.id}/export`);
  if (!res.ok) throw new Error(`Failed to export ${receivingReport.rrNumber}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${receivingReport.rrNumber}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function ViewReceivingReportModal({ isOpen, onClose, receivingReportId }) {
  const [receivingReport, setReceivingReport] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  useEffect(() => {
    if (!isOpen || !receivingReportId) return;

    let cancelled = false;
    setReceivingReport(null);
    setLoadError(null);
    setIsLoading(true);

    fetch(`${API_BASE_URL}/receiving-reports/${receivingReportId}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load receiving report');
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setReceivingReport(data);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, receivingReportId]);

  const handleDownload = async () => {
    if (!receivingReport) return;
    setIsDownloading(true);
    setDownloadError(null);
    try {
      await downloadReceivingReportFile(receivingReport);
    } catch (err) {
      setDownloadError(err.message);
    } finally {
      setIsDownloading(false);
    }
  };

  if (!isOpen) return null;

  const totalAmount = (receivingReport?.items || []).reduce(
    (sum, it) => sum + Number(it.quantity) * Number(it.unitCost),
    0
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-modal-backdrop">
      <div className="font-sans bg-white rounded-2xl shadow-2xl shadow-slate-900/20 max-w-3xl w-full border border-slate-200/80 max-h-[88vh] flex flex-col animate-modal-card overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 bg-[#0B132B] border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-500/30">
              <ClipboardCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">Receiving Report</p>
              <h3 className="text-lg font-black text-white tracking-tight">
                {receivingReport?.rrNumber || 'Loading...'}
              </h3>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white hover:bg-white/10 p-2 rounded-full transition-colors cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {isLoading && (
            <div className="flex items-center justify-center py-12 text-slate-400 gap-2 text-sm">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading receiving report...
            </div>
          )}

          {!isLoading && loadError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">
              {loadError}
            </div>
          )}

          {!isLoading && receivingReport && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Source PO</p>
                  <p className="text-xs font-bold text-slate-800">{receivingReport.purchaseOrder?.poNumber || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Supplier</p>
                  <p className="text-xs font-bold text-slate-800">{receivingReport.supplier?.name || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Received</p>
                  <p className="text-xs font-bold text-slate-800">{new Date(receivingReport.receivedAt).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Received By</p>
                  <p className="text-xs font-bold text-slate-800">{receivingReport.receivedBy?.username || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">DR Number</p>
                  <p className="text-xs font-medium text-slate-600">{receivingReport.deliveryNote || '—'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Invoice No.</p>
                  <p className="text-xs font-medium text-slate-600">{receivingReport.invoiceNo || '—'}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Remarks</p>
                  <p className="text-xs font-medium text-slate-600">{receivingReport.remarks || '—'}</p>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-extrabold uppercase text-[10px] tracking-wider border-b-2 border-slate-200">
                    <tr>
                      <th className="px-4 py-3">Barcode</th>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3 text-center">Qty</th>
                      <th className="px-4 py-3 text-right">Unit Cost</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {receivingReport.items.map((it) => (
                      <tr key={it.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 font-mono text-slate-500">{it.product?.barcode}</td>
                        <td className="px-4 py-3 font-semibold text-slate-800">{it.product?.name}</td>
                        <td className="px-4 py-3 text-center text-slate-700">{it.quantity}</td>
                        <td className="px-4 py-3 text-right text-slate-700">₱{Number(it.unitCost).toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900">₱{(Number(it.quantity) * Number(it.unitCost)).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end">
                <p className="text-xs font-semibold text-slate-500">
                  Total: <span className="text-base text-slate-900 font-black">₱{totalAmount.toFixed(2)}</span>
                </p>
              </div>

              {downloadError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">
                  {downloadError}
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-5 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 transition cursor-pointer"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!receivingReport || isDownloading}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-tr from-emerald-600 to-teal-600 hover:shadow-lg hover:shadow-emerald-500/30 text-white font-bold text-xs rounded-xl shadow-md transition disabled:opacity-50 cursor-pointer"
          >
            {isDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {isDownloading ? 'Downloading...' : 'Download RR (.xlsx)'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
