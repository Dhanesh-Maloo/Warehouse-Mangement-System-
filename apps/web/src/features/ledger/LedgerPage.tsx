import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../lib/auth';
import { Download, X } from 'lucide-react';

interface LedgerEntry {
  id: string;
  eventType: string;
  assetId: string;
  asset: {
    id: string;
    serialNumber: string;
    assetTag: string | null;
    model: string;
  };
  quantity: number;
  unitRatePaise: string;
  amountPaise: string;
  occurredAt: string;
  referenceType: string | null;
  referenceId: string | null;
}

function formatPaise(p: string) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(
    Number(p) / 100,
  );
}

export function LedgerPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';
  const clientId =
    user?.role === 'client_user' || user?.role === 'editor'
      ? (user.clientId ?? undefined)
      : undefined;

  const now = new Date();
  const [fromDate, setFromDate] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
  );
  const [toDate, setToDate] = useState(now.toISOString().slice(0, 10));
  const [showCorrection, setShowCorrection] = useState(false);
  const [correctionEventId, setCorrectionEventId] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionError, setCorrectionError] = useState('');

  const params = new URLSearchParams();
  if (clientId) params.set('clientId', clientId);
  if (fromDate) params.set('fromDate', fromDate);
  if (toDate) params.set('toDate', toDate);

  const { data, isLoading } = useQuery({
    queryKey: ['ledger', clientId, fromDate, toDate],
    queryFn: () => api.get<LedgerEntry[]>(`/ledger?${params.toString()}`),
  });

  const correctionMutation = useMutation({
    mutationFn: () =>
      api.post('/ledger/correction', {
        originalEventId: correctionEventId,
        reason: correctionReason,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ledger'] });
      setShowCorrection(false);
      setCorrectionEventId('');
      setCorrectionReason('');
    },
    onError: (e: Error) => setCorrectionError(e.message),
  });

  const entries = data ?? [];
  const runningTotal = entries.reduce((sum, e) => sum + Number(e.amountPaise), 0);

  function handleExport() {
    const p = new URLSearchParams(params);
    window.open(`/api/v1/ledger/export?${p.toString()}`, '_blank');
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ledger</h1>
          <p className="text-sm text-gray-500 mt-1">Append-only event ledger</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <button
              onClick={() => {
                setShowCorrection(true);
                setCorrectionError('');
              }}
              className="border border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50"
            >
              Post correction
            </button>
          )}
          <button
            onClick={handleExport}
            className="flex items-center gap-2 border border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50"
          >
            <Download size={16} />
            Export CSV
          </button>
        </div>
      </div>

      {showCorrection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Post ledger correction</h2>
              <button
                onClick={() => setShowCorrection(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              A correction creates a new reversal entry (negative amount) — the original entry is
              never modified.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Original event ID <span className="text-red-500">*</span>
                </label>
                <input
                  value={correctionEventId}
                  onChange={(e) => setCorrectionEventId(e.target.value)}
                  placeholder="Paste event UUID from the table below"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  rows={3}
                  placeholder="Explain why this correction is needed…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] resize-none"
                />
              </div>
            </div>
            {correctionError && <p className="text-sm text-red-600">{correctionError}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => correctionMutation.mutate()}
                disabled={!correctionEventId || !correctionReason || correctionMutation.isPending}
                className="flex-1 bg-[#E86F2C] text-white text-sm font-semibold py-2.5 rounded-lg disabled:opacity-40"
              >
                {correctionMutation.isPending ? 'Posting…' : 'Post correction'}
              </button>
              <button
                onClick={() => setShowCorrection(false)}
                className="px-4 text-sm text-gray-600 rounded-lg hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">From date</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">To date</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wide">
                  <th className="text-left px-5 py-3">Event</th>
                  <th className="text-left px-5 py-3">Asset</th>
                  <th className="text-left px-5 py-3">Qty</th>
                  <th className="text-right px-5 py-3">Unit rate</th>
                  <th className="text-right px-5 py-3">Amount</th>
                  <th className="text-left px-5 py-3">Date/time (IST)</th>
                  <th className="text-left px-5 py-3">Ref</th>
                  <th className="text-left px-5 py-3">Event ID</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr
                    key={e.id}
                    onClick={() => navigate(`/inventory/${e.assetId}`)}
                    className="border-b border-gray-50 hover:bg-orange-50/40 cursor-pointer transition-colors"
                  >
                    <td className="px-5 py-3">
                      <span className="font-mono text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                        {e.eventType}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-mono text-xs font-semibold text-[#E86F2C]">
                        {e.asset?.assetTag ?? e.asset?.serialNumber ?? e.assetId.slice(0, 8) + '…'}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">{e.asset?.model}</div>
                    </td>
                    <td className="px-5 py-3 tabular-nums text-gray-700">
                      {e.quantity > 0 ? `+${e.quantity}` : e.quantity}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-600">
                      {formatPaise(e.unitRatePaise)}
                    </td>
                    <td
                      className={`px-5 py-3 text-right font-semibold tabular-nums ${Number(e.amountPaise) < 0 ? 'text-red-600' : 'text-gray-900'}`}
                    >
                      {formatPaise(e.amountPaise)}
                    </td>
                    <td className="px-5 py-3 text-gray-600 text-xs whitespace-nowrap">
                      {new Date(e.occurredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs capitalize">
                      {e.referenceType ?? '—'}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-400 select-all">
                      {e.id.slice(0, 8)}…
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-gray-400 text-sm">
                      No ledger entries for the selected period.
                    </td>
                  </tr>
                )}
              </tbody>
              {entries.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td colSpan={4} className="px-5 py-3 text-sm font-semibold text-gray-700">
                      Period total ({entries.length} events)
                    </td>
                    <td
                      className={`px-5 py-3 text-right font-bold tabular-nums text-base ${runningTotal < 0 ? 'text-red-600' : 'text-gray-900'}`}
                    >
                      {new Intl.NumberFormat('en-IN', {
                        style: 'currency',
                        currency: 'INR',
                      }).format(runningTotal / 100)}
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
