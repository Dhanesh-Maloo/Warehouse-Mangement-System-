import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth } from '../../lib/auth';
import {
  CheckCircle,
  AlertTriangle,
  HardDrive,
  Package,
  Building2,
  Play,
  RefreshCw,
  CalendarDays,
  TrendingUp,
  Receipt,
} from 'lucide-react';

// ─── Types (matching actual API response) ────────────────────────────────────

interface Client {
  id: string;
  name: string;
  slug: string;
}

interface StorageSummary {
  clientId: string;
  clientName: string | null;
  laptopCount: number;
  peripheralCount: number;
  laptopProjectedPaise: string;
  peripheralProjectedPaise: string;
  totalProjectedPaise: string;
  minimumCommitmentPaise: string;
  minimumCommitmentMet: boolean;
  shortfallPaise: string | null;
  rates: { laptopPerDevicePaise: string; peripheralPerDevicePaise: string };
  lastAccrualRun: {
    id: string;
    periodStart: string;
    periodEnd: string;
    totalAmountPaise: string;
    minimumCommitmentMet: boolean;
    createdAt: string;
  } | null;
}

interface AccrualRun {
  id: string;
  periodStart: string;
  periodEnd: string;
  laptopCount: number;
  peripheralCount: number;
  totalDeviceCount: number;
  laptopAmountPaise: string;
  peripheralAmountPaise: string;
  totalAmountPaise: string;
  minimumCommitmentPaise: string;
  minimumCommitmentMet: boolean;
  createdAt: string;
  client: { id: string; name: string; slug: string };
}

interface AccrualRunResult {
  totalClients: number;
  clientsBelowCommitment: number;
  periodStart: string;
  periodEnd: string;
  clientResults: {
    clientId: string;
    clientName: string;
    totalDeviceCount: number;
    totalAmountPaise: string;
    minimumCommitmentMet: boolean;
    skipped: boolean;
    skipReason?: string;
  }[];
}

interface LedgerEntry {
  id: string;
  eventType: string;
  quantity: number;
  unitRatePaise: string;
  amountPaise: string;
  occurredAt: string;
  referenceType: string | null;
  notes: string | null;
  asset: { id: string; serialNumber: string; assetTag: string | null; model: string };
}

const EVENT_LABELS: Record<string, string> = {
  INGEST: 'Inbound (Ingest)',
  CORRECTION_INGEST: 'Correction — Ingest',
  INSPECT: 'Inspection',
  PICK_PACK: 'Deployment (Pick & Pack)',
  FULL_PREP: 'Deployment (Full Prep)',
  LABELING: 'Labeling',
  REPACKING: 'Repacking',
  COURIER_CITY: 'Courier — City',
  COURIER_INTERSTATE: 'Courier — Interstate',
  COURIER_RURAL: 'Courier — Rural',
  RETRIEVAL: 'Retrieval (Standard)',
  RETRIEVAL_FULL_CYCLE: 'Retrieval (Full Cycle)',
  DISPOSAL_NON_CERT: 'Disposal (Non-certified)',
  DISPOSAL_CERTIFIED: 'Disposal (Certified)',
  DISPOSAL_ITAD: 'Disposal (ITAD)',
  STORAGE_LAPTOP: 'Storage — Laptop',
  STORAGE_PERIPHERAL: 'Storage — Peripheral',
  STORAGE_LAPTOP_REVERSAL: 'Storage Reversal — Laptop',
  STORAGE_PERIPHERAL_REVERSAL: 'Storage Reversal — Peripheral',
  COMMITMENT_ADJUSTMENT: 'Commitment Adjustment',
};

const EVENT_CATEGORY: Record<string, string> = {
  INGEST: 'Inbound',
  CORRECTION_INGEST: 'Inbound',
  INSPECT: 'Inspection',
  PICK_PACK: 'Deployment',
  FULL_PREP: 'Deployment',
  LABELING: 'Deployment',
  REPACKING: 'Deployment',
  COURIER_CITY: 'Courier',
  COURIER_INTERSTATE: 'Courier',
  COURIER_RURAL: 'Courier',
  RETRIEVAL: 'Retrieval',
  RETRIEVAL_FULL_CYCLE: 'Retrieval',
  DISPOSAL_NON_CERT: 'Disposal',
  DISPOSAL_CERTIFIED: 'Disposal',
  DISPOSAL_ITAD: 'Disposal',
  STORAGE_LAPTOP: 'Storage',
  STORAGE_PERIPHERAL: 'Storage',
  STORAGE_LAPTOP_REVERSAL: 'Storage',
  STORAGE_PERIPHERAL_REVERSAL: 'Storage',
  COMMITMENT_ADJUSTMENT: 'Storage',
};

const CATEGORY_COLORS: Record<string, string> = {
  Inbound: 'bg-blue-100 text-blue-700',
  Inspection: 'bg-purple-100 text-purple-700',
  Deployment: 'bg-orange-100 text-orange-700',
  Courier: 'bg-sky-100 text-sky-700',
  Retrieval: 'bg-amber-100 text-amber-700',
  Disposal: 'bg-red-100 text-red-700',
  Storage: 'bg-emerald-100 text-emerald-700',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function paise(s: string | null | undefined): bigint {
  if (!s) return 0n;
  try {
    return BigInt(s);
  } catch {
    return 0n;
  }
}

function formatINR(p: string | bigint | null | undefined): string {
  const val = typeof p === 'bigint' ? p : paise(typeof p === 'string' ? p : '0');
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(
    Number(val) / 100,
  );
}

function periodLabel(start: string): string {
  // @db.Date fields arrive as UTC midnight (e.g. "2026-06-01T00:00:00.000Z").
  // Parsing via new Date() shifts it to May 31 IST. Extract the date string directly instead.
  const dateOnly = start.slice(0, 10); // "2026-06-01"
  const [year, month] = dateOnly.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  count,
  projected,
  rateLabel,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  projected: string;
  rateLabel: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-gray-500">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-3xl font-bold text-gray-900 tabular-nums">{count}</p>
          <p className="text-xs text-gray-400 mt-0.5">{rateLabel}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-500">Projected</p>
          <p className="text-base font-semibold text-gray-800 tabular-nums">
            {formatINR(projected)}/mo
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function BillingPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'admin';
  const isAdminOrManager = isAdmin || user?.role === 'manager';
  const isClientUser = user?.role === 'client_user';

  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [accrualResult, setAccrualResult] = useState<AccrualRunResult | null>(null);
  const [accrualError, setAccrualError] = useState('');

  // Transaction date range — default to current month
  const now = new Date();
  const [txFromDate, setTxFromDate] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
  );
  const [txToDate, setTxToDate] = useState(now.toISOString().slice(0, 10));

  // Load client list for admin/manager selector
  const { data: clients = [] } = useQuery({
    queryKey: ['clients-list'],
    queryFn: () => api.get<{ data: Client[] }>('/clients').then((r) => r.data),
    enabled: isAdminOrManager,
    staleTime: 60_000,
  });

  const effectiveClientId = isClientUser
    ? (user.clientId ?? '')
    : selectedClientId || (clients[0]?.id ?? '');

  const summaryParams = new URLSearchParams();
  if (effectiveClientId) summaryParams.set('clientId', effectiveClientId);

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useQuery({
    queryKey: ['storage-summary', effectiveClientId],
    queryFn: () => api.get<StorageSummary>(`/storage/summary?${summaryParams.toString()}`),
    enabled: !!effectiveClientId,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: accrualRuns = [], isLoading: runsLoading } = useQuery({
    queryKey: ['accrual-runs', effectiveClientId],
    queryFn: () => {
      const p = new URLSearchParams();
      if (effectiveClientId) p.set('clientId', effectiveClientId);
      return api.get<AccrualRun[]>(`/storage/accrual-runs?${p.toString()}`);
    },
    enabled: isAdminOrManager,
  });

  const { data: ledgerEntries = [], isLoading: ledgerLoading, refetch: refetchLedger } = useQuery({
    queryKey: ['billing-ledger', effectiveClientId, txFromDate, txToDate],
    queryFn: () => {
      const p = new URLSearchParams();
      if (effectiveClientId) p.set('clientId', effectiveClientId);
      if (txFromDate) p.set('fromDate', txFromDate);
      if (txToDate) p.set('toDate', txToDate);
      p.set('take', '500');
      return api.get<LedgerEntry[]>(`/ledger?${p.toString()}`);
    },
    enabled: !!effectiveClientId,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  // Aggregate by category for the summary chips
  const categoryTotals = ledgerEntries.reduce<Record<string, bigint>>((acc, e) => {
    const cat = EVENT_CATEGORY[e.eventType] ?? 'Other';
    acc[cat] = (acc[cat] ?? 0n) + paise(e.amountPaise);
    return acc;
  }, {});
  const periodTotal = ledgerEntries.reduce((sum, e) => sum + paise(e.amountPaise), 0n);

  const runAccrualMutation = useMutation({
    mutationFn: () => api.post<AccrualRunResult>('/storage/run-accrual', {}),
    onSuccess: (result) => {
      setAccrualResult(result);
      setAccrualError('');
      void qc.invalidateQueries({ queryKey: ['storage-summary'] });
      void qc.invalidateQueries({ queryKey: ['accrual-runs'] });
      void qc.invalidateQueries({ queryKey: ['billing-ledger'] });
    },
    onError: (e: Error) => setAccrualError(e.message),
  });

  const totalPaise = paise(summary?.totalProjectedPaise);
  const shortfall = paise(summary?.shortfallPaise);
  const commitmentMet = summary?.minimumCommitmentMet ?? false;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Storage &amp; Billing</h1>
          <p className="text-sm text-gray-500 mt-1">Monthly storage overview and accrual history</p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Client selector */}
          {isAdminOrManager && clients.length > 0 && (
            <div className="flex items-center gap-2">
              <Building2 size={15} className="text-gray-400 flex-shrink-0" />
              <select
                value={effectiveClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
              >
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Sync button — refresh live counts from inventory */}
          <button
            onClick={() => {
              void refetchSummary();
              void refetchLedger();
              void qc.invalidateQueries({ queryKey: ['storage-summary'] });
              void qc.invalidateQueries({ queryKey: ['accrual-runs'] });
              void qc.invalidateQueries({ queryKey: ['billing-ledger'] });
            }}
            disabled={summaryLoading || ledgerLoading}
            title="Sync with inventory"
            className="flex items-center gap-2 border border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={15} className={(summaryLoading || ledgerLoading) ? 'animate-spin' : ''} />
            Sync
          </button>

          {/* Run Accrual — admin only */}
          {isAdmin && (
            <button
              onClick={() => {
                setAccrualResult(null);
                setAccrualError('');
                runAccrualMutation.mutate();
              }}
              disabled={runAccrualMutation.isPending}
              className="flex items-center gap-2 bg-[#E86F2C] hover:bg-[#D05E1E] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {runAccrualMutation.isPending ? (
                <RefreshCw size={15} className="animate-spin" />
              ) : (
                <Play size={15} />
              )}
              {runAccrualMutation.isPending ? 'Running…' : 'Run accrual'}
            </button>
          )}
        </div>
      </div>

      {/* Accrual run result banner */}
      {accrualResult && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle size={16} className="text-emerald-600" />
            <p className="text-sm font-semibold text-emerald-800">
              Accrual complete — {periodLabel(accrualResult.periodStart)}
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            {accrualResult.clientResults.map((cr) => (
              <div
                key={cr.clientId}
                className="bg-white rounded-lg border border-emerald-100 px-4 py-3"
              >
                <p className="text-xs font-semibold text-gray-700 truncate">{cr.clientName}</p>
                <p className="text-sm font-bold text-gray-900 tabular-nums mt-0.5">
                  {cr.skipped ? (
                    <span className="text-gray-400 font-normal text-xs">
                      {cr.skipReason ?? 'Skipped'}
                    </span>
                  ) : (
                    formatINR(cr.totalAmountPaise)
                  )}
                </p>
                <p className="text-xs text-gray-400">{cr.totalDeviceCount} devices</p>
              </div>
            ))}
          </div>
          <button
            onClick={() => setAccrualResult(null)}
            className="mt-3 text-xs text-emerald-600 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {accrualError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          Accrual failed: {accrualError}
        </div>
      )}

      {/* Section 1 — Current Storage Summary */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold text-gray-700">Current Storage Summary</h2>

        {!effectiveClientId ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-12 text-center text-gray-400 text-sm">
            Select a client above to view their storage summary.
          </div>
        ) : summaryLoading ? (
          <div className="text-sm text-gray-400 py-4">Loading storage data…</div>
        ) : !summary ? (
          <div className="text-sm text-red-500">Failed to load storage summary.</div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                icon={<HardDrive size={16} />}
                label="Laptops in storage"
                count={summary.laptopCount}
                projected={summary.laptopProjectedPaise}
                rateLabel={`₹${(Number(paise(summary.rates?.laptopPerDevicePaise)) / 100).toFixed(0)}/unit/month`}
              />
              <StatCard
                icon={<Package size={16} />}
                label="Peripherals in storage"
                count={summary.peripheralCount}
                projected={summary.peripheralProjectedPaise}
                rateLabel={`₹${(Number(paise(summary.rates?.peripheralPerDevicePaise)) / 100).toFixed(0)}/unit/month`}
              />

              {/* Total projected */}
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-gray-500">
                  <TrendingUp size={16} />
                  <span className="text-sm font-medium">Total projected / month</span>
                </div>
                <p className="text-3xl font-bold text-gray-900 tabular-nums">
                  {formatINR(summary.totalProjectedPaise)}
                </p>
                <p className="text-xs text-gray-400">
                  Min. commitment: {formatINR(summary.minimumCommitmentPaise)}/mo
                </p>
              </div>

            </div>

            {/* Last accrual run summary bar */}
            {summary.lastAccrualRun && (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-3 flex items-center gap-3 text-sm flex-wrap">
                <CalendarDays size={15} className="text-gray-400 flex-shrink-0" />
                <span className="text-gray-500">Last accrual run:</span>
                <span className="font-medium text-gray-800">
                  {periodLabel(summary.lastAccrualRun.periodStart)}
                </span>
                <span className="text-gray-400">·</span>
                <span className="font-semibold text-gray-900 tabular-nums">
                  {formatINR(summary.lastAccrualRun.totalAmountPaise)}
                </span>
                <span className="text-gray-400">·</span>
                {summary.lastAccrualRun.minimumCommitmentMet ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                    <CheckCircle size={11} /> Commitment met
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                    <AlertTriangle size={11} /> Below minimum
                  </span>
                )}
                <span className="ml-auto text-xs text-gray-400">
                  {new Date(summary.lastAccrualRun.createdAt).toLocaleString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            )}
          </>
        )}
      </section>

      {/* Section 2 — Accrual Run History */}
      {isAdminOrManager && (
        <section className="space-y-4">
          <h2 className="text-base font-semibold text-gray-700">Accrual Run History</h2>

          {runsLoading ? (
            <div className="text-sm text-gray-400 py-4">Loading accrual runs…</div>
          ) : accrualRuns.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-12 text-center text-gray-400 text-sm">
              No accrual runs recorded yet.{' '}
              {isAdmin && (
                <button
                  onClick={() => runAccrualMutation.mutate()}
                  className="text-[#E86F2C] underline hover:no-underline"
                >
                  Run the first accrual
                </button>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wide">
                      <th className="text-left px-5 py-3">Period</th>
                      <th className="text-left px-5 py-3">Client</th>
                      <th className="text-right px-5 py-3">Laptops</th>
                      <th className="text-right px-5 py-3">Peripherals</th>
                      <th className="text-right px-5 py-3">Laptop billing</th>
                      <th className="text-right px-5 py-3">Peripheral billing</th>
                      <th className="text-right px-5 py-3">Total billed</th>
                      <th className="text-center px-5 py-3">Min. commitment</th>
                      <th className="text-left px-5 py-3">Run at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accrualRuns.map((run) => (
                      <tr key={run.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-5 py-3 font-medium text-gray-900 whitespace-nowrap">
                          {periodLabel(run.periodStart)}
                        </td>
                        <td className="px-5 py-3 text-gray-600">{run.client.name}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-gray-700">
                          {run.laptopCount.toLocaleString('en-IN')}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums text-gray-700">
                          {run.peripheralCount.toLocaleString('en-IN')}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums text-gray-600">
                          {formatINR(run.laptopAmountPaise)}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums text-gray-600">
                          {formatINR(run.peripheralAmountPaise)}
                        </td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums text-gray-900">
                          {formatINR(run.totalAmountPaise)}
                        </td>
                        <td className="px-5 py-3 text-center">
                          {run.minimumCommitmentMet ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2.5 py-0.5 rounded-full">
                              <CheckCircle size={11} /> Met
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-full">
                              <AlertTriangle size={11} /> Below
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-gray-500 text-xs whitespace-nowrap">
                          {new Date(run.createdAt).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Section 3 — Transaction Charges */}
      <section className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Receipt size={16} className="text-gray-500" />
            <h2 className="text-base font-semibold text-gray-700">Transaction Charges</h2>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label className="text-gray-500 text-xs">From</label>
            <input
              type="date"
              value={txFromDate}
              onChange={(e) => setTxFromDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
            />
            <label className="text-gray-500 text-xs">To</label>
            <input
              type="date"
              value={txToDate}
              onChange={(e) => setTxToDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
            />
          </div>
        </div>

        {!effectiveClientId ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-12 text-center text-gray-400 text-sm">
            Select a client above to view transaction charges.
          </div>
        ) : ledgerLoading ? (
          <div className="text-sm text-gray-400 py-4">Loading transactions…</div>
        ) : (
          <>
            {/* Period total + category chips */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-sm text-gray-500">
                  Period total ({ledgerEntries.length} events)
                </span>
                <span className="text-2xl font-bold text-gray-900 tabular-nums">
                  {formatINR(periodTotal.toString())}
                </span>
              </div>
              {Object.keys(categoryTotals).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(categoryTotals)
                    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
                    .map(([cat, total]) => (
                      <div
                        key={cat}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${CATEGORY_COLORS[cat] ?? 'bg-gray-100 text-gray-600'}`}
                      >
                        <span>{cat}</span>
                        <span className="font-bold">{formatINR(total.toString())}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Detail table */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              {ledgerEntries.length === 0 ? (
                <div className="px-5 py-12 text-center text-gray-400 text-sm">
                  No transactions in this period.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wide">
                        <th className="text-left px-5 py-3">Event</th>
                        <th className="text-left px-5 py-3">Asset</th>
                        <th className="text-right px-5 py-3">Qty</th>
                        <th className="text-right px-5 py-3">Unit rate</th>
                        <th className="text-right px-5 py-3">Amount</th>
                        <th className="text-left px-5 py-3">Date / time (IST)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerEntries.map((e) => {
                        const cat = EVENT_CATEGORY[e.eventType] ?? 'Other';
                        const chipCls = CATEGORY_COLORS[cat] ?? 'bg-gray-100 text-gray-600';
                        const amt = paise(e.amountPaise);
                        const isNegative = amt < 0n;
                        return (
                          <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50/40">
                            <td className="px-5 py-3 whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${chipCls}`}>
                                {EVENT_LABELS[e.eventType] ?? e.eventType}
                              </span>
                            </td>
                            <td className="px-5 py-3">
                              <p className="font-mono text-xs font-semibold text-[#E86F2C]">
                                {e.asset.serialNumber}
                              </p>
                              <p className="text-xs text-gray-400">{e.asset.model}</p>
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums text-gray-700 text-xs">
                              {e.quantity > 0 ? `+${e.quantity}` : e.quantity}
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums text-gray-600 text-xs">
                              {formatINR(e.unitRatePaise)}
                            </td>
                            <td className={`px-5 py-3 text-right tabular-nums font-semibold text-xs ${isNegative ? 'text-red-600' : 'text-gray-900'}`}>
                              {formatINR(e.amountPaise)}
                            </td>
                            <td className="px-5 py-3 text-gray-500 text-xs whitespace-nowrap">
                              {new Date(e.occurredAt).toLocaleString('en-IN', {
                                timeZone: 'Asia/Kolkata',
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
