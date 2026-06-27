import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../lib/auth';
import {
  Package,
  PackagePlus,
  ClipboardCheck,
  TrendingUp,
  AlertTriangle,
  Clock,
  Truck,
  ArrowRight,
  FlaskConical,
  Trash2,
  Loader2,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SummaryData {
  [key: string]: number;
}

interface Inspection {
  id: string;
  type: string;
  status: string;
  startedAt: string;
  asset: { serialNumber: string; model: string; manufacturer: string };
}

interface Delivery {
  id: string;
  supplierName: string;
  expectedDate: string;
  status: string;
  client: { name: string };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SLA_TARGET_MINUTES = 1440; // 24 business hours (approximated as calendar)

function slaStatus(startedAt: string): 'on_track' | 'at_risk' | 'breached' {
  const elapsed = (Date.now() - new Date(startedAt).getTime()) / 60_000;
  if (elapsed >= SLA_TARGET_MINUTES) return 'breached';
  if (elapsed >= SLA_TARGET_MINUTES * 0.8) return 'at_risk';
  return 'on_track';
}

const SLA_COLORS = {
  on_track: 'bg-emerald-100 text-emerald-700',
  at_risk: 'bg-amber-100 text-amber-700',
  breached: 'bg-red-100 text-red-700',
};
const SLA_ICONS = {
  on_track: Clock,
  at_risk: AlertTriangle,
  breached: AlertTriangle,
};

function minutesElapsed(startedAt: string) {
  const m = Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  sub,
  to,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
  sub?: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex items-center gap-4 hover:shadow-md hover:border-gray-200 transition-all cursor-pointer group"
    >
      <div className={`p-3 rounded-lg ${color}`}>
        <Icon size={20} className="text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-2xl font-bold text-gray-900">{value.toLocaleString('en-IN')}</div>
        <div className="text-sm text-gray-500 group-hover:text-[#E86F2C] transition-colors">
          {label}
        </div>
        {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
      </div>
      <ArrowRight
        size={16}
        className="text-gray-300 group-hover:text-[#E86F2C] flex-shrink-0 transition-colors"
      />
    </Link>
  );
}

// ─── Demo Panel ───────────────────────────────────────────────────────────────

interface DemoStatus {
  seeded: boolean;
  assetCount: number;
  userCount: number;
}

function DemoPanel() {
  const qc = useQueryClient();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ['demo-status'],
    queryFn: () => api.get<DemoStatus>('/demo/status'),
  });

  const seedMutation = useMutation({
    mutationFn: () => api.post<{ message: string }>('/demo/seed', {}),
    onSuccess: () => {
      void qc.invalidateQueries();
    },
  });

  const teardownMutation = useMutation({
    mutationFn: () => api.del<{ message: string }>('/demo/seed'),
    onSuccess: () => {
      setConfirmRemove(false);
      void qc.invalidateQueries();
    },
  });

  const busy = seedMutation.isPending || teardownMutation.isPending;

  return (
    <div className="bg-white rounded-xl border border-dashed border-gray-300 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-3">
        <FlaskConical size={16} className="text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-600">Demo data</h2>
        {isLoading && <Loader2 size={13} className="animate-spin text-gray-300 ml-auto" />}
      </div>

      {status?.seeded ? (
        <div className="space-y-3">
          <div className="text-xs text-gray-500">
            Techflow Solutions demo loaded —{' '}
            <span className="font-medium text-gray-700">{status.assetCount} assets</span>,{' '}
            {status.userCount} users.
            <br />
            Credentials: any <code className="bg-gray-100 px-1 rounded">@demo.local</code> user,
            password <code className="bg-gray-100 px-1 rounded">Demo@1234</code>
          </div>
          {!confirmRemove ? (
            <button
              onClick={() => setConfirmRemove(true)}
              disabled={busy}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              <Trash2 size={12} />
              Remove demo data
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-red-600 font-medium">
                This will delete all Techflow demo data. Are you sure?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => teardownMutation.mutate()}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {teardownMutation.isPending ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Trash2 size={12} />
                  )}
                  Yes, remove
                </button>
                <button
                  onClick={() => setConfirmRemove(false)}
                  disabled={busy}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
              {teardownMutation.isError && (
                <p className="text-xs text-red-500">{String(teardownMutation.error)}</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Load 22 realistic assets across all statuses — inspections, deployments, retrievals,
            disposals, and ledger entries — to explore the full app.
          </p>
          <button
            onClick={() => seedMutation.mutate()}
            disabled={busy}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-[#E86F2C] border border-orange-200 rounded-lg hover:bg-orange-50 transition-colors disabled:opacity-50"
          >
            {seedMutation.isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <FlaskConical size={12} />
            )}
            Load demo data
          </button>
          {seedMutation.isError && (
            <p className="text-xs text-red-500">{String(seedMutation.error)}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const clientId = user?.role === 'client_user' ? (user.clientId ?? undefined) : undefined;

  const summaryParams = clientId ? `?clientId=${clientId}` : '';

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['inventory-summary', clientId],
    queryFn: () => api.get<SummaryData>(`/inventory/summary${summaryParams}`),
  });

  const { data: pendingInspData } = useQuery({
    queryKey: ['pending-inspections-dashboard', clientId],
    queryFn: () => {
      const p = new URLSearchParams({ status: 'in_progress', take: '10' });
      if (clientId) p.set('clientId', clientId);
      return api.get<Inspection[]>(`/inspections?${p.toString()}`);
    },
  });
  const pendingInspections = pendingInspData ?? [];

  const { data: todayDeliveriesData } = useQuery({
    queryKey: ['today-deliveries', clientId],
    enabled: !clientId, // only internal users see this
    queryFn: () => {
      const today = new Date().toISOString().slice(0, 10);
      return api.get<Delivery[]>(`/inbound/deliveries?expectedDate=${today}&take=5`);
    },
  });
  const todayDeliveries = todayDeliveriesData ?? [];

  const totalAssets = summary ? Object.values(summary).reduce((a, b) => a + b, 0) : 0;

  const breachedCount = pendingInspections.filter(
    (i) => slaStatus(i.startedAt) === 'breached',
  ).length;
  const atRiskCount = pendingInspections.filter((i) => slaStatus(i.startedAt) === 'at_risk').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Asset overview — all statuses as of now</p>
      </div>

      {summaryLoading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : (
        <>
          {/* SLA alert banner */}
          {breachedCount > 0 && (
            <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-3">
              <AlertTriangle size={18} className="text-red-500 flex-shrink-0" />
              <span className="text-sm font-medium text-red-700">
                {breachedCount} inspection{breachedCount !== 1 ? 's' : ''} have breached their
                24-hour SLA
              </span>
              <Link
                to="/inspections"
                className="ml-auto text-sm text-red-600 hover:text-red-800 font-semibold flex items-center gap-1"
              >
                View <ArrowRight size={14} />
              </Link>
            </div>
          )}

          {/* Stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Total assets"
              value={totalAssets}
              icon={Package}
              color="bg-[#1A2B3C]"
              to="/inventory"
            />
            <StatCard
              label="In storage"
              value={summary?.in_storage ?? 0}
              icon={Package}
              color="bg-emerald-500"
              to="/inventory?status=in_storage"
            />
            <StatCard
              label="Pending inspection"
              value={summary?.in_inspection ?? 0}
              icon={ClipboardCheck}
              color={
                breachedCount > 0 ? 'bg-red-500' : atRiskCount > 0 ? 'bg-amber-500' : 'bg-amber-400'
              }
              sub={
                breachedCount > 0
                  ? `${breachedCount} breached SLA`
                  : atRiskCount > 0
                    ? `${atRiskCount} at risk`
                    : undefined
              }
              to="/inspections"
            />
            <StatCard
              label="Deployed"
              value={summary?.deployed ?? 0}
              icon={TrendingUp}
              color="bg-[#E86F2C]"
              to="/inventory?status=deployed"
            />
          </div>

          {/* Full asset breakdown */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-700">Full asset breakdown</h2>
                <p className="text-xs text-gray-400 mt-0.5">All statuses — should sum to {totalAssets}</p>
              </div>
              <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
                {totalAssets} total
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { key: 'receiving',     label: 'Receiving',     color: 'bg-blue-50 border-blue-200',     dot: 'bg-blue-400',    text: 'text-blue-700',    href: '/inventory?status=receiving' },
                { key: 'in_inspection', label: 'In Inspection', color: 'bg-amber-50 border-amber-200',   dot: 'bg-amber-400',   text: 'text-amber-700',   href: '/inspections' },
                { key: 'in_storage',    label: 'In Storage',    color: 'bg-emerald-50 border-emerald-200', dot: 'bg-emerald-400', text: 'text-emerald-700', href: '/inventory?status=in_storage' },
                { key: 'deployed',      label: 'Deployed',      color: 'bg-orange-50 border-orange-200', dot: 'bg-[#E86F2C]',   text: 'text-orange-700',  href: '/inventory?status=deployed' },
                { key: 'returning',     label: 'Returning',     color: 'bg-purple-50 border-purple-200', dot: 'bg-purple-400',  text: 'text-purple-700',  href: '/inventory?status=returning' },
                { key: 'disposed',      label: 'Disposed',      color: 'bg-gray-50 border-gray-200',     dot: 'bg-gray-400',    text: 'text-gray-600',    href: '/inventory?status=disposed' },
              ].map(({ key, label, color, dot, text, href }) => {
                const count = summary?.[key] ?? 0;
                const pct = totalAssets > 0 ? Math.round((count / totalAssets) * 100) : 0;
                return (
                  <Link
                    key={key}
                    to={href}
                    className={`flex flex-col gap-2 p-3 rounded-lg border ${color} hover:shadow-sm transition-all group`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
                      <span className="text-xs text-gray-500 group-hover:text-gray-700 transition-colors leading-tight">{label}</span>
                    </div>
                    <div className={`text-2xl font-bold ${text}`}>{count}</div>
                    <div className="text-xs text-gray-400">{pct}%</div>
                    <div className="h-1 bg-white/60 rounded-full overflow-hidden">
                      <div className={`h-1 rounded-full ${dot} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                  </Link>
                );
              })}
            </div>
            {/* Sum check */}
            <div className="mt-4 flex items-center gap-2 text-xs text-gray-400">
              <span>
                {[
                  { key: 'receiving', label: 'Receiving' },
                  { key: 'in_inspection', label: 'Inspection' },
                  { key: 'in_storage', label: 'Storage' },
                  { key: 'deployed', label: 'Deployed' },
                  { key: 'returning', label: 'Returning' },
                  { key: 'disposed', label: 'Disposed' },
                ]
                  .filter(({ key }) => (summary?.[key] ?? 0) > 0)
                  .map(({ key, label }) => `${label}: ${summary?.[key] ?? 0}`)
                  .join(' + ')}{' '}
                = <span className="font-semibold text-gray-600">{totalAssets}</span>
              </span>
            </div>
          </div>

          {/* Bottom panels */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Status breakdown */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Asset status breakdown</h2>
              <div className="space-y-3">
                {[
                  { key: 'receiving', label: 'Receiving', color: 'bg-blue-400' },
                  { key: 'in_inspection', label: 'In inspection', color: 'bg-amber-400' },
                  { key: 'in_storage', label: 'In storage', color: 'bg-emerald-400' },
                  { key: 'deployed', label: 'Deployed', color: 'bg-[#E86F2C]' },
                  { key: 'returning', label: 'Returning', color: 'bg-purple-400' },
                  { key: 'disposed', label: 'Disposed', color: 'bg-gray-400' },
                ].map(({ key, label, color }) => {
                  const count = summary?.[key] ?? 0;
                  const pct = totalAssets > 0 ? (count / totalAssets) * 100 : 0;
                  const href =
                    key === 'in_inspection' ? '/inspections' : `/inventory?status=${key}`;
                  return (
                    <Link
                      key={key}
                      to={href}
                      className="block group rounded-lg hover:bg-gray-50 -mx-2 px-2 py-1 transition-colors"
                    >
                      <div className="flex justify-between text-xs text-gray-600 mb-1">
                        <span className="group-hover:text-[#E86F2C] transition-colors">
                          {label}
                        </span>
                        <span className="font-medium">{count}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full">
                        <div
                          className={`h-1.5 rounded-full ${color} transition-all`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Pending inspections with SLA */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-700">Open inspections</h2>
                <Link to="/inspections" className="text-xs text-[#E86F2C] hover:underline">
                  View all
                </Link>
              </div>
              {pendingInspections.length === 0 ? (
                <div className="text-center py-8 text-sm text-gray-400">
                  <ClipboardCheck size={20} className="mx-auto mb-2 text-gray-300" />
                  No open inspections
                </div>
              ) : (
                <div className="space-y-2">
                  {pendingInspections.slice(0, 6).map((insp) => {
                    const status = slaStatus(insp.startedAt);
                    const StatusIcon = SLA_ICONS[status];
                    return (
                      <Link
                        key={insp.id}
                        to={`/inspections/${insp.id}`}
                        className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-mono font-semibold text-gray-900 truncate">
                            {insp.asset.serialNumber}
                          </div>
                          <div className="text-xs text-gray-500 truncate">
                            {insp.asset.manufacturer} {insp.asset.model}
                          </div>
                        </div>
                        <div
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${SLA_COLORS[status]}`}
                        >
                          <StatusIcon size={11} />
                          {minutesElapsed(insp.startedAt)}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Today's deliveries / Quick actions */}
            {!clientId ? (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-gray-700">
                    {"Today's expected deliveries"}
                  </h2>
                  <Link to="/inbound" className="text-xs text-[#E86F2C] hover:underline">
                    View all
                  </Link>
                </div>
                {todayDeliveries.length === 0 ? (
                  <div className="text-center py-8 text-sm text-gray-400">
                    <Truck size={20} className="mx-auto mb-2 text-gray-300" />
                    Nothing expected today
                  </div>
                ) : (
                  <div className="space-y-2">
                    {todayDeliveries.map((d) => (
                      <Link
                        key={d.id}
                        to={`/inbound/${d.id}`}
                        className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-gray-900 truncate">
                            {d.supplierName}
                          </div>
                          <div className="text-xs text-gray-500">{d.client.name}</div>
                        </div>
                        <span
                          className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                            d.status === 'received'
                              ? 'bg-emerald-100 text-emerald-700'
                              : d.status === 'partial'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {d.status}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Quick actions</h2>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'View inventory', icon: Package, href: '/inventory' },
                    { label: 'Inspections', icon: ClipboardCheck, href: '/inspections' },
                    { label: 'Deployments', icon: Truck, href: '/deployment' },
                    { label: 'Ledger', icon: TrendingUp, href: '/ledger' },
                  ].map(({ label, icon: Icon, href }) => (
                    <Link
                      key={label}
                      to={href}
                      className="flex flex-col items-center justify-center gap-2 p-4 rounded-lg border border-gray-200 hover:border-[#E86F2C] hover:bg-orange-50 transition-colors text-center"
                    >
                      <Icon size={20} className="text-[#E86F2C]" />
                      <span className="text-xs font-medium text-gray-700">{label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Quick actions for non-client users */}
            {!clientId && (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 lg:col-start-1">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Quick actions</h2>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Log expected delivery', icon: PackagePlus, href: '/inbound' },
                    { label: 'Start inspection', icon: ClipboardCheck, href: '/inspections' },
                    { label: 'View inventory', icon: Package, href: '/inventory' },
                    { label: 'View ledger', icon: TrendingUp, href: '/ledger' },
                  ].map(({ label, icon: Icon, href }) => (
                    <Link
                      key={label}
                      to={href}
                      className="flex flex-col items-center justify-center gap-2 p-4 rounded-lg border border-gray-200 hover:border-[#E86F2C] hover:bg-orange-50 transition-colors text-center"
                    >
                      <Icon size={20} className="text-[#E86F2C]" />
                      <span className="text-xs font-medium text-gray-700">{label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Demo data panel — admin only */}
          {isAdmin && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <DemoPanel />
            </div>
          )}
        </>
      )}
    </div>
  );
}
