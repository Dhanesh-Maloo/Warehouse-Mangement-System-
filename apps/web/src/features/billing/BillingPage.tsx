import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth } from '../../lib/auth';
import {
  CheckCircle,
  HardDrive,
  Package,
  Building2,
  Play,
  RefreshCw,
  CalendarDays,
  TrendingUp,
  Receipt,
  Search,
  X,
  Warehouse,
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
  commitmentProjectedPaise: string;
  totalProjectedPaise: string;
  rates: { laptopPerDevicePaise: string; peripheralPerDevicePaise: string };
  commitment: {
    amountPaise: string;
    laptopCount: number;
    peripheralCount: number;
  } | null;
  lastAccrualRun: {
    id: string;
    periodStart: string;
    periodEnd: string;
    totalAmountPaise: string;
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
  createdAt: string;
  client: { id: string; name: string; slug: string };
}

interface AccrualRunResult {
  totalClients: number;
  periodStart: string;
  periodEnd: string;
  clientResults: {
    clientId: string;
    clientName: string;
    totalDeviceCount: number;
    totalAmountPaise: string;
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

interface AssetSearchResult {
  id: string;
  serialNumber: string;
  assetTag: string | null;
  model: string;
  manufacturer: string;
  category: string;
  currentStatus: string;
}

interface AssetBillingSummary {
  asset: {
    id: string;
    serialNumber: string;
    assetTag: string | null;
    model: string;
    manufacturer: string;
    category: string;
    currentStatus: string;
  };
  month: string;
  periodStart: string;
  periodEnd: string;
  daysInStorage: number;
  totalChargesPaise: string;
  ledgerEntries: LedgerEntry[];
}

const EVENT_LABELS: Record<string, string> = {
  INGEST: 'Inbound (Ingest)',
  CORRECTION_INGEST: 'Correction - Ingest',
  INSPECT: 'Inspection',
  PICK_PACK: 'Deployment (Pick & Pack)',
  FULL_PREP: 'Deployment (Full Prep)',
  LABELING: 'Labeling',
  REPACKING: 'Repacking',
  COURIER_CITY: 'Courier - City',
  COURIER_INTERSTATE: 'Courier - Interstate',
  COURIER_RURAL: 'Courier - Rural',
  RETRIEVAL: 'Retrieval (Standard)',
  RETRIEVAL_FULL_CYCLE: 'Retrieval (Full Cycle)',
  DISPOSAL_NON_CERT: 'Disposal (Non-certified)',
  DISPOSAL_CERTIFIED: 'Disposal (Certified)',
  DISPOSAL_ITAD: 'Disposal (ITAD)',
  STORAGE_LAPTOP: 'Storage - Laptop',
  STORAGE_PERIPHERAL: 'Storage - Peripheral',
  STORAGE_COMMITMENT: 'Storage - Minimum Commitment',
  STORAGE_LAPTOP_REVERSAL: 'Storage Reversal - Laptop',
  STORAGE_PERIPHERAL_REVERSAL: 'Storage Reversal - Peripheral',
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
  STORAGE_COMMITMENT: 'Storage',
  STORAGE_LAPTOP_REVERSAL: 'Storage',
  STORAGE_PERIPHERAL_REVERSAL: 'Storage',
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
  const isEditor = user?.role === 'editor';
  const isClientAdmin = user?.role === 'client_admin';
  // editors are scoped to their own client like client_users
  const isClientScoped = isClientUser || isEditor || isClientAdmin;

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

  const effectiveClientId = isClientScoped
    ? (user?.clientId ?? '')
    : selectedClientId || (clients[0]?.id ?? '');

  const summaryParams = new URLSearchParams();
  if (effectiveClientId) summaryParams.set('clientId', effectiveClientId);

  const {
    data: summary,
    isLoading: summaryLoading,
    refetch: refetchSummary,
  } = useQuery({
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
    enabled: isAdminOrManager || isEditor || isClientAdmin,
  });

  const {
    data: ledgerEntries = [],
    isLoading: ledgerLoading,
    refetch: refetchLedger,
  } = useQuery({
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

  // ── Asset billing lookup: find one asset and see everything billed
  // against it — actions taken, charges, and days in storage — for a
  // chosen month.
  const [assetSearch, setAssetSearch] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<AssetSearchResult | null>(null);
  const [billingMonth, setBillingMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  );

  const { data: assetSearchResults = [], isFetching: assetSearchLoading } = useQuery({
    queryKey: ['asset-search', effectiveClientId, assetSearch],
    queryFn: () => {
      const p = new URLSearchParams();
      if (effectiveClientId) p.set('clientId', effectiveClientId);
      p.set('search', assetSearch);
      p.set('take', '8');
      return api.get<{ data: AssetSearchResult[] }>(`/assets?${p.toString()}`).then((r) => r.data);
    },
    enabled: assetSearch.trim().length >= 2 && !selectedAsset,
    staleTime: 10_000,
  });

  const {
    data: assetBillingSummary,
    isLoading: assetBillingLoading,
    error: assetBillingError,
  } = useQuery({
    queryKey: ['asset-billing-summary', selectedAsset?.id, billingMonth],
    queryFn: () =>
      api.get<AssetBillingSummary>(
        `/assets/${selectedAsset?.id}/billing-summary?month=${billingMonth}`,
      ),
    enabled: !!selectedAsset,
  });

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
            <RefreshCw
              size={15}
              className={summaryLoading || ledgerLoading ? 'animate-spin' : ''}
            />
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
              Accrual complete - {periodLabel(accrualResult.periodStart)}
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
            {summary.commitment && (
              <div className="bg-[#E86F2C]/5 border border-[#E86F2C]/20 rounded-xl px-5 py-3 text-sm text-gray-700">
                <span className="font-semibold text-[#E86F2C]">
                  {formatINR(summary.commitment.amountPaise)}/month minimum commitment
                </span>{' '}
                covers up to {summary.commitment.laptopCount} laptops and{' '}
                {summary.commitment.peripheralCount} peripherals — billed flat regardless of count.
                {summary.laptopCount > summary.commitment.laptopCount ||
                summary.peripheralCount > summary.commitment.peripheralCount ? (
                  <>
                    {' '}
                    Currently{' '}
                    {summary.laptopCount > summary.commitment.laptopCount && (
                      <strong>
                        {summary.laptopCount - summary.commitment.laptopCount} laptop
                        {summary.laptopCount - summary.commitment.laptopCount === 1 ? '' : 's'}
                      </strong>
                    )}
                    {summary.laptopCount > summary.commitment.laptopCount &&
                      summary.peripheralCount > summary.commitment.peripheralCount &&
                      ' and '}
                    {summary.peripheralCount > summary.commitment.peripheralCount && (
                      <strong>
                        {summary.peripheralCount - summary.commitment.peripheralCount} peripheral
                        {summary.peripheralCount - summary.commitment.peripheralCount === 1
                          ? ''
                          : 's'}
                      </strong>
                    )}{' '}
                    over the limit, billed per-device on top.
                  </>
                ) : (
                  ' Currently within the commitment — no extra device charges.'
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                icon={<HardDrive size={16} />}
                label={
                  summary.commitment
                    ? 'Laptops in storage (billable over limit)'
                    : 'Laptops in storage'
                }
                count={summary.laptopCount}
                projected={summary.laptopProjectedPaise}
                rateLabel={`₹${(Number(paise(summary.rates?.laptopPerDevicePaise)) / 100).toFixed(0)}/unit/month`}
              />
              <StatCard
                icon={<Package size={16} />}
                label={
                  summary.commitment
                    ? 'Peripherals in storage (billable over limit)'
                    : 'Peripherals in storage'
                }
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
                {summary.commitment && (
                  <p className="text-xs text-gray-400">
                    Includes {formatINR(summary.commitmentProjectedPaise)} commitment
                  </p>
                )}
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
                              <span
                                className={`px-2 py-0.5 rounded-full text-xs font-medium ${chipCls}`}
                              >
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
                            <td
                              className={`px-5 py-3 text-right tabular-nums font-semibold text-xs ${isNegative ? 'text-red-600' : 'text-gray-900'}`}
                            >
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

      {/* Section 4 — Asset Billing Lookup */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Search size={16} className="text-gray-500" />
          <h2 className="text-base font-semibold text-gray-700">Asset Billing Lookup</h2>
        </div>
        <p className="text-sm text-gray-500 -mt-2">
          Find one device and see everything billed against it — what was done (inspection,
          retrieval, repair, etc.), what it cost, and how many days it sat in storage for a chosen
          month.
        </p>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
          {!selectedAsset ? (
            <div className="relative">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                value={assetSearch}
                onChange={(e) => setAssetSearch(e.target.value)}
                placeholder="Search by serial number, asset tag, or model…"
                className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
              />
              {assetSearch.trim().length >= 2 && (
                <div className="mt-2 border border-gray-100 rounded-lg divide-y divide-gray-50 overflow-hidden">
                  {assetSearchLoading ? (
                    <div className="px-4 py-3 text-sm text-gray-400">Searching…</div>
                  ) : assetSearchResults.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-gray-400">No matching assets found.</div>
                  ) : (
                    assetSearchResults.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => {
                          setSelectedAsset(a);
                          setAssetSearch('');
                        }}
                        className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center justify-between gap-3"
                      >
                        <div>
                          <p className="text-sm font-mono font-semibold text-[#E86F2C]">
                            {a.serialNumber}
                          </p>
                          <p className="text-xs text-gray-400">
                            {a.model} · {a.manufacturer}
                            {a.assetTag ? ` · Tag: ${a.assetTag}` : ''}
                          </p>
                        </div>
                        <span className="text-xs text-gray-500 capitalize">
                          {a.currentStatus.replace(/_/g, ' ')}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-mono font-semibold text-[#E86F2C]">
                    {selectedAsset.serialNumber}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {selectedAsset.model} · {selectedAsset.manufacturer}
                    {selectedAsset.assetTag ? ` · Tag: ${selectedAsset.assetTag}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="month"
                    value={billingMonth}
                    onChange={(e) => setBillingMonth(e.target.value)}
                    className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                  />
                  <button
                    onClick={() => setSelectedAsset(null)}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg px-2.5 py-1.5"
                  >
                    <X size={13} /> Change asset
                  </button>
                </div>
              </div>

              {assetBillingLoading ? (
                <div className="text-sm text-gray-400 py-6">Loading billing detail…</div>
              ) : assetBillingError ? (
                <div className="text-sm text-red-500 py-2">Failed to load billing detail.</div>
              ) : assetBillingSummary ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="flex items-center gap-2 text-gray-500 text-xs">
                        <Warehouse size={14} /> Days in storage this month
                      </div>
                      <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">
                        {assetBillingSummary.daysInStorage}
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="flex items-center gap-2 text-gray-500 text-xs">
                        <Receipt size={14} /> Total charged this month
                      </div>
                      <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">
                        {formatINR(assetBillingSummary.totalChargesPaise)}
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="flex items-center gap-2 text-gray-500 text-xs">
                        <CalendarDays size={14} /> Current status
                      </div>
                      <p className="text-lg font-semibold text-gray-900 mt-1.5 capitalize">
                        {assetBillingSummary.asset.currentStatus.replace(/_/g, ' ')}
                      </p>
                    </div>
                  </div>

                  <div className="border border-gray-100 rounded-lg overflow-hidden">
                    {assetBillingSummary.ledgerEntries.length === 0 ? (
                      <div className="px-4 py-8 text-center text-gray-400 text-sm">
                        No charges against this asset in{' '}
                        {periodLabel(assetBillingSummary.periodStart)}.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wide">
                              <th className="text-left px-4 py-2.5">Action</th>
                              <th className="text-right px-4 py-2.5">Qty</th>
                              <th className="text-right px-4 py-2.5">Unit rate</th>
                              <th className="text-right px-4 py-2.5">Amount</th>
                              <th className="text-left px-4 py-2.5">Date (IST)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {assetBillingSummary.ledgerEntries.map((e) => {
                              const cat = EVENT_CATEGORY[e.eventType] ?? 'Other';
                              const chipCls = CATEGORY_COLORS[cat] ?? 'bg-gray-100 text-gray-600';
                              const amt = paise(e.amountPaise);
                              return (
                                <tr
                                  key={e.id}
                                  className="border-b border-gray-50 hover:bg-gray-50/40"
                                >
                                  <td className="px-4 py-2.5 whitespace-nowrap">
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${chipCls}`}
                                    >
                                      {EVENT_LABELS[e.eventType] ?? e.eventType}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 text-xs">
                                    {e.quantity > 0 ? `+${e.quantity}` : e.quantity}
                                  </td>
                                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-600 text-xs">
                                    {formatINR(e.unitRatePaise)}
                                  </td>
                                  <td
                                    className={`px-4 py-2.5 text-right tabular-nums font-semibold text-xs ${amt < 0n ? 'text-red-600' : 'text-gray-900'}`}
                                  >
                                    {formatINR(e.amountPaise)}
                                  </td>
                                  <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
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
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
